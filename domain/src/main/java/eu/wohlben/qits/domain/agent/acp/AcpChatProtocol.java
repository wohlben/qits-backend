package eu.wohlben.qits.domain.agent.acp;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import eu.wohlben.qits.domain.command.control.ChatProtocol;
import eu.wohlben.qits.domain.command.control.ChatWire;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import org.jboss.logging.Logger;

/**
 * The in-JVM ACP (Agent Client Protocol) client that drives a {@code kimi acp} process as a chat.
 * Kimi has no stream-json stdin mode, so this sits between the plain pipes {@code CommandRegistry}
 * spawns and the {@link ChatWire}, speaking JSON-RPC 2.0 line-by-line: {@code initialize} → {@code
 * session/new} (or {@code session/resume}) with the scoped MCP servers, {@code session/prompt} per
 * user turn, {@code session/cancel} on teardown, and {@code session/update} notifications inbound —
 * normalized by {@link KimiEventNormalizer} into the one envelope the frontend renders. Incoming
 * {@code session/request_permission} requests are auto-approved (today's yolo-equivalent posture).
 *
 * <p><strong>Threading.</strong> A <em>reader</em> thread owns every inbound message and is the
 * sole caller of the normalizer, the wire, and the turn-end flush — so no lock guards conversation
 * state. A <em>sender</em> thread serializes the outbound request sequence (handshake first, then
 * one prompt at a time), blocking on each request's result only to order turns; it never touches
 * the normalizer. Both write JSON-RPC to stdin under one lock. When the process output closes,
 * {@code onEnd} latches the session exit exactly once.
 */
public final class AcpChatProtocol implements ChatProtocol {

  private static final Logger LOG = Logger.getLogger(AcpChatProtocol.class);

  /** The ACP protocol version qits speaks. */
  private static final int PROTOCOL_VERSION = 1;

  private final ObjectMapper mapper = new ObjectMapper();
  private final Process process;
  private final AcpSessionConfig config;
  private final KimiEventNormalizer normalizer = new KimiEventNormalizer(null);

  private final BufferedWriter stdin;
  private final Object stdinLock = new Object();
  private final AtomicInteger nextId = new AtomicInteger(1);
  private final Map<Integer, Pending> pending = new ConcurrentHashMap<>();
  private final LinkedBlockingQueue<Runnable> senderTasks = new LinkedBlockingQueue<>();

  private volatile ChatWire wire;
  private volatile String sessionId;
  private volatile boolean closed;

  public AcpChatProtocol(Process process, AcpSessionConfig config) {
    this.process = process;
    this.config = config;
    this.stdin =
        new BufferedWriter(
            new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
  }

  /**
   * A request awaiting its response: the future serializes the sender; {@code onResult} runs on the
   * reader thread (so it may touch the normalizer/wire) before the future completes.
   */
  private record Pending(CompletableFuture<JsonNode> future, Consumer<JsonNode> onResult) {}

  @Override
  public void start(ChatWire wire, Runnable onEnd) {
    this.wire = wire;
    startThread("kimi-acp-reader", () -> readLoop(onEnd));
    startThread("kimi-acp-sender", this::senderLoop);
    // The handshake is the first sender task, so any seed prompt queued right after launch runs
    // strictly after the session is open.
    senderTasks.add(this::handshake);
  }

  @Override
  public void sendUser(String text) {
    // Echo immediately so the sender sees their turn even before the session is ready / mid-turn.
    emit(userEcho(text));
    senderTasks.add(() -> prompt(text));
  }

  @Override
  public void close() {
    if (closed) {
      return;
    }
    closed = true;
    if (sessionId != null) {
      writeQuietly(notification("session/cancel", sessionParams()));
    }
    // Unblock the sender and reader; closing stdin sends EOF to kimi. Close under stdinLock so it
    // can't interleave with a concurrent writeMessage on the sender thread (BufferedWriter is not
    // thread-safe).
    senderTasks.add(() -> {});
    synchronized (stdinLock) {
      try {
        stdin.close();
      } catch (IOException ignored) {
        // best effort
      }
    }
    failAllPending(new IllegalStateException("chat closed"));
  }

  // --- outbound (sender thread) ----------------------------------------------------------------

  private void senderLoop() {
    try {
      while (!closed) {
        Runnable task = senderTasks.take();
        task.run();
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }

  private void handshake() {
    try {
      call("initialize", initializeParams(), null).get();
      JsonNode params = config.resumeSessionId() == null ? newSessionParams() : resumeParams();
      String method = config.resumeSessionId() == null ? "session/new" : "session/resume";
      call(
              method,
              params,
              result -> {
                String id =
                    firstNonBlank(result.path("sessionId").asText(""), config.resumeSessionId());
                if (id != null && !id.isBlank()) {
                  sessionId = id;
                  normalizer.setSessionId(id);
                  if (config.onSessionId() != null) {
                    try {
                      config.onSessionId().accept(id);
                    } catch (RuntimeException e) {
                      LOG.warnf(e, "session-id sink failed for %s", id);
                    }
                  }
                }
              })
          .get();
    } catch (Exception e) {
      LOG.debugf(e, "ACP handshake ended");
    }
  }

  private void prompt(String text) {
    if (sessionId == null) {
      // The handshake never established a session, so the already-echoed turn can't be sent —
      // surface an error bubble instead of leaving the chat silently hung.
      emit(errorEnvelope("Kimi chat session was not established; your message was not delivered."));
      return;
    }
    try {
      call(
              "session/prompt",
              promptParams(text),
              // The turn is over: flush any buffered assistant text and clear the indicator, on the
              // reader thread that produced the chunks.
              result -> finishTurn())
          .get();
    } catch (Exception e) {
      LOG.debugf(e, "ACP prompt ended");
    }
  }

  /**
   * Sends a request and returns a future the sender awaits; {@code onResult} runs on the reader.
   */
  private CompletableFuture<JsonNode> call(
      String method, JsonNode params, Consumer<JsonNode> onResult) {
    int id = nextId.getAndIncrement();
    CompletableFuture<JsonNode> future = new CompletableFuture<>();
    pending.put(id, new Pending(future, onResult));
    try {
      writeMessage(request(id, method, params));
    } catch (RuntimeException e) {
      pending.remove(id);
      future.completeExceptionally(e);
    }
    return future;
  }

  // --- inbound (reader thread) -----------------------------------------------------------------

  private void readLoop(Runnable onEnd) {
    try (BufferedReader out =
        new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = out.readLine()) != null) {
        if (!line.isBlank()) {
          dispatch(line);
        }
      }
    } catch (IOException e) {
      LOG.debugf(e, "ACP reader ended");
    } finally {
      failAllPending(new IllegalStateException("ACP stream closed"));
      // A natural process exit (kimi exits / container recycled) never routes through close(), so
      // stop the sender here too — otherwise its take() blocks forever, leaking a thread per chat.
      closed = true;
      senderTasks.add(() -> {});
      onEnd.run();
    }
  }

  private void dispatch(String line) {
    JsonNode node;
    try {
      node = mapper.readTree(line);
    } catch (IOException e) {
      LOG.debugf("Dropping non-JSON ACP line: %s", line);
      return;
    }
    if (node.has("method")) {
      onIncoming(node);
    } else if (node.has("id")) {
      onResponse(node);
    }
  }

  private void onIncoming(JsonNode node) {
    String method = node.path("method").asText("");
    JsonNode params = node.path("params");
    switch (method) {
      case "session/update" -> emitAll(normalizer.onAcpUpdate(params.path("update")));
      case "session/request_permission" -> respondPermission(node.get("id"), params);
      default -> {
        // We advertise no fs/terminal capabilities, so kimi shouldn't ask; if it does, answer any
        // request (has an id) with method-not-found so it is never left hanging.
        if (node.has("id")) {
          writeQuietly(errorResponse(node.get("id"), -32601, "Method not supported: " + method));
        }
      }
    }
  }

  private void onResponse(JsonNode node) {
    int id = node.path("id").asInt(-1);
    Pending p = pending.remove(id);
    if (p == null) {
      return;
    }
    if (node.has("error")) {
      p.future()
          .completeExceptionally(
              new IllegalStateException("ACP error: " + node.path("error").toString()));
      return;
    }
    JsonNode result = node.path("result");
    if (p.onResult() != null) {
      try {
        p.onResult().accept(result);
      } catch (RuntimeException e) {
        LOG.warnf(e, "ACP result handler failed");
      }
    }
    p.future().complete(result);
  }

  /** Auto-approve: pick an "allow" option (else the first) and select it. */
  private void respondPermission(JsonNode id, JsonNode params) {
    String optionId = null;
    JsonNode options = params.path("options");
    if (options.isArray()) {
      for (JsonNode option : options) {
        String kind = option.path("kind").asText("");
        if (kind.startsWith("allow")) {
          optionId = option.path("optionId").asText(null);
          break;
        }
      }
      if (optionId == null && options.size() > 0) {
        optionId = options.get(0).path("optionId").asText(null);
      }
    }
    ObjectNode outcome = mapper.createObjectNode();
    if (optionId != null) {
      outcome.put("outcome", "selected");
      outcome.put("optionId", optionId);
    } else {
      outcome.put("outcome", "cancelled");
    }
    ObjectNode result = mapper.createObjectNode();
    result.set("outcome", outcome);
    writeQuietly(resultResponse(id, result));
  }

  private void finishTurn() {
    emitAll(normalizer.finishTurn());
  }

  // --- envelopes / JSON-RPC framing ------------------------------------------------------------

  private void emitAll(java.util.List<String> lines) {
    for (String line : lines) {
      emit(line);
    }
  }

  private void emit(String line) {
    ChatWire w = wire;
    if (w != null) {
      w.emit(line);
    }
  }

  private String userEcho(String text) {
    ObjectNode node = mapper.createObjectNode();
    node.put("type", "user");
    node.put("text", text);
    return node.toString();
  }

  /** An error {@code result} envelope the frontend renders as a failure bubble. */
  private String errorEnvelope(String message) {
    ObjectNode node = mapper.createObjectNode();
    node.put("type", "result");
    node.put("subtype", "error");
    node.put("is_error", true);
    node.put("result", message);
    return node.toString();
  }

  private ObjectNode initializeParams() {
    ObjectNode params = mapper.createObjectNode();
    params.put("protocolVersion", PROTOCOL_VERSION);
    ObjectNode caps = params.putObject("clientCapabilities");
    ObjectNode fs = caps.putObject("fs");
    fs.put("readTextFile", false);
    fs.put("writeTextFile", false);
    caps.put("terminal", false);
    return params;
  }

  private ObjectNode newSessionParams() {
    ObjectNode params = mapper.createObjectNode();
    params.put("cwd", config.cwd());
    params.set("mcpServers", mcpServersNode());
    return params;
  }

  private ObjectNode resumeParams() {
    ObjectNode params = newSessionParams();
    params.put("sessionId", config.resumeSessionId());
    return params;
  }

  private ArrayNode mcpServersNode() {
    ArrayNode servers = mapper.createArrayNode();
    for (AcpSessionConfig.AcpMcpServer server : config.mcpServers()) {
      ObjectNode node = mapper.createObjectNode();
      node.put("type", "http");
      node.put("name", server.name());
      node.put("url", server.url());
      if (server.enabledTools() != null && !server.enabledTools().isEmpty()) {
        ArrayNode tools = node.putArray("enabledTools");
        server.enabledTools().forEach(tools::add);
      }
      servers.add(node);
    }
    return servers;
  }

  private ObjectNode promptParams(String text) {
    ObjectNode params = mapper.createObjectNode();
    params.put("sessionId", sessionId);
    ArrayNode prompt = params.putArray("prompt");
    ObjectNode block = mapper.createObjectNode();
    block.put("type", "text");
    block.put("text", text);
    prompt.add(block);
    return params;
  }

  private ObjectNode sessionParams() {
    ObjectNode params = mapper.createObjectNode();
    params.put("sessionId", sessionId);
    return params;
  }

  private ObjectNode request(int id, String method, JsonNode params) {
    ObjectNode node = baseMessage();
    node.put("id", id);
    node.put("method", method);
    node.set("params", params);
    return node;
  }

  private ObjectNode notification(String method, JsonNode params) {
    ObjectNode node = baseMessage();
    node.put("method", method);
    node.set("params", params);
    return node;
  }

  private ObjectNode resultResponse(JsonNode id, JsonNode result) {
    ObjectNode node = baseMessage();
    node.set("id", id);
    node.set("result", result);
    return node;
  }

  private ObjectNode errorResponse(JsonNode id, int code, String message) {
    ObjectNode node = baseMessage();
    node.set("id", id);
    ObjectNode error = node.putObject("error");
    error.put("code", code);
    error.put("message", message);
    return node;
  }

  private ObjectNode baseMessage() {
    ObjectNode node = mapper.createObjectNode();
    node.put("jsonrpc", "2.0");
    return node;
  }

  private void writeMessage(ObjectNode message) {
    synchronized (stdinLock) {
      try {
        stdin.write(message.toString());
        stdin.write("\n");
        stdin.flush();
      } catch (IOException e) {
        throw new IllegalStateException("Failed to write ACP message", e);
      }
    }
  }

  /** Best-effort write for reader-thread responses — a closed stream must not crash the reader. */
  private void writeQuietly(ObjectNode message) {
    try {
      writeMessage(message);
    } catch (RuntimeException e) {
      LOG.debugf(e, "ACP response write failed");
    }
  }

  private void failAllPending(Exception cause) {
    for (Integer id : pending.keySet()) {
      Pending p = pending.remove(id);
      if (p != null) {
        p.future().completeExceptionally(cause);
      }
    }
  }

  private static void startThread(String name, Runnable body) {
    Thread t = new Thread(body, name);
    t.setDaemon(true);
    t.start();
  }

  private static String firstNonBlank(String a, String b) {
    return a != null && !a.isBlank() ? a : b;
  }
}
