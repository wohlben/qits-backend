package eu.wohlben.qits.domain.agent.acp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Normalizes Kimi Code's conversation into the Claude event envelope the frontend already renders
 * ({@code chat-stream.ts}), from <em>two</em> sources that must agree:
 *
 * <ul>
 *   <li>{@link #onAcpUpdate} — a live ACP {@code session/update} notification's {@code update}
 *       object, streamed from the in-JVM ACP client during a chat.
 *   <li>{@link #onWireLine} — one persisted {@code wire.jsonl} line, replayed by the transcript
 *       importer.
 * </ul>
 *
 * Both feed one envelope builder and mint uuids through {@link KimiChatUuids}, so the same logical
 * event lands with the same {@code uuid} on the live ring and in the durable transcript — the
 * re-attach seam. Live ACP streams assistant text as many small {@code *_chunk}s; this coalesces
 * them into one assistant message per turn (flushed at a tool boundary or {@link #finishTurn}) so
 * the granularity matches {@code wire.jsonl}'s complete messages.
 *
 * <p>Stateful and single-threaded by construction (one instance per live session or per imported
 * transcript file); framework-free for trivial unit testing.
 */
public final class KimiEventNormalizer {

  private final ObjectMapper mapper = new ObjectMapper();

  private String sessionId;
  private String sidechainAgentId;

  private final StringBuilder assistantBuf = new StringBuilder();
  private final StringBuilder thoughtBuf = new StringBuilder();
  private int assistantIdx;
  private int thoughtIdx;
  private int userIdx;

  /** Tool-call ids whose result was already emitted, so a streamed tool never double-renders. */
  private final Set<String> toolResultsEmitted = new HashSet<>();

  public KimiEventNormalizer(String sessionId) {
    this.sessionId = sessionId;
  }

  /** The session id is only known after {@code session/new} for a live chat; set it then. */
  public void setSessionId(String sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Marks this normalizer as importing a subagent sidechain: emitted lines carry {@code
   * isSidechain}/{@code agentId} (so the frontend groups them under their Task call), and uuids are
   * scoped by the sidechain id so a sidechain's message indices never collide with the main
   * thread's.
   */
  public KimiEventNormalizer asSidechain(String agentId) {
    this.sidechainAgentId = agentId;
    return this;
  }

  /**
   * Resets all coalescing/indexing state so the normalizer can re-import a transcript from the
   * start — used by the live tail when the file is unexpectedly truncated/replaced and re-seeded.
   */
  public void reset() {
    assistantBuf.setLength(0);
    thoughtBuf.setLength(0);
    assistantIdx = 0;
    thoughtIdx = 0;
    userIdx = 0;
    toolResultsEmitted.clear();
  }

  /**
   * Normalizes one live ACP {@code update} object (the {@code params.update} of a {@code
   * session/update} notification). Text/thought chunks are buffered and coalesced; tool events and
   * a turn boundary flush them.
   */
  public List<String> onAcpUpdate(JsonNode update) {
    List<String> out = new ArrayList<>();
    if (update == null || !update.isObject()) {
      return out;
    }
    String kind = update.path("sessionUpdate").asText("");
    switch (kind) {
      case "agent_message_chunk" -> {
        flushThought(out);
        assistantBuf.append(textOf(update.path("content")));
      }
      case "agent_thought_chunk" -> {
        flushAssistant(out);
        thoughtBuf.append(textOf(update.path("content")));
      }
      case "tool_call" -> {
        flushAssistant(out);
        flushThought(out);
        String toolCallId = update.path("toolCallId").asText("");
        String title = firstNonBlank(update.path("title").asText(""), "tool");
        out.add(toolUseLine(toolCallId, title));
      }
      case "tool_call_update" -> {
        String toolCallId = update.path("toolCallId").asText("");
        String text = toolContentText(update.path("content"));
        boolean error = "failed".equals(update.path("status").asText(""));
        // A tool that streams output sends several content-bearing updates for one toolCallId;
        // emit the result once (the first content or the failure) so it matches the single
        // tool_result the wire.jsonl importer produces and never double-renders in the live ring.
        if ((!text.isBlank() || error) && toolResultsEmitted.add(toolCallId)) {
          out.add(toolResultLine(toolCallId, text, error));
        }
      }
      default -> {
        // user_message_chunk (we emit our own synthetic echo), plan, available_commands_update,
        // and any future variant — not conversation the frontend renders.
      }
    }
    return out;
  }

  /**
   * Flushes any buffered assistant text/thought and marks the turn's end (clears the indicator).
   */
  public List<String> finishTurn() {
    List<String> out = new ArrayList<>();
    flushAssistant(out);
    flushThought(out);
    out.add(resultLine());
    return out;
  }

  /** {@link #onWireLine(JsonNode)} for a raw line — parses it (dropping unparseable lines). */
  public List<String> onWireLine(String rawLine) {
    try {
      return onWireLine(mapper.readTree(rawLine));
    } catch (JsonProcessingException e) {
      return List.of();
    }
  }

  /**
   * Normalizes one persisted {@code wire.jsonl} line into zero or more envelope lines. Complete
   * messages (not chunks), so no buffering — {@code metadata}/{@code config}/{@code session} noise
   * is dropped, and message roles map to the same envelope shapes the live path produces.
   */
  public List<String> onWireLine(JsonNode line) {
    List<String> out = new ArrayList<>();
    if (line == null || !line.isObject()) {
      return out;
    }
    if (line.has("metadata") || line.has("config") || line.has("session")) {
      return out; // request-trace noise (protocol metadata, config.update, resume hints).
    }
    String role = line.path("role").asText("");
    JsonNode content = line.path("content");
    switch (role) {
      case "user" -> {
        String text = plainText(content);
        if (!text.isBlank()) {
          out.add(userLine(text));
        }
      }
      case "assistant" -> emitAssistantBlocks(out, content);
      case "tool" -> {
        String toolCallId = firstNonBlank(line.path("tool_call_id").asText(""), "");
        String text = plainText(content);
        if (!text.isBlank()) {
          out.add(toolResultLine(toolCallId, text, false));
        }
      }
      default -> {
        // unknown role — drop.
      }
    }
    return out;
  }

  // --- envelope builders -----------------------------------------------------------------------

  private void flushAssistant(List<String> out) {
    if (assistantBuf.length() > 0) {
      out.add(assistantTextLine(assistantBuf.toString()));
      assistantBuf.setLength(0);
    }
  }

  private void flushThought(List<String> out) {
    if (thoughtBuf.length() > 0) {
      out.add(thinkingLine(thoughtBuf.toString()));
      thoughtBuf.setLength(0);
    }
  }

  /**
   * A {@code wire.jsonl} assistant message: text/thinking/tool_use blocks (or a bare string).
   * <strong>Consecutive</strong> text (or thinking) blocks are coalesced into one envelope,
   * breaking only at a tool_use or a type switch — mirroring the live path, which coalesces {@code
   * agent_message_chunk}s until a tool boundary. Matching the granularity keeps the minted {@code
   * a:idx}/{@code t:idx} indices aligned across the two sources, so the re-attach seam stitches
   * even for tool-free turns.
   */
  private void emitAssistantBlocks(List<String> out, JsonNode content) {
    if (content.isTextual()) {
      if (!content.asText().isBlank()) {
        out.add(assistantTextLine(content.asText()));
      }
      return;
    }
    if (!content.isArray()) {
      return;
    }
    StringBuilder textRun = new StringBuilder();
    StringBuilder thoughtRun = new StringBuilder();
    for (JsonNode block : content) {
      switch (block.path("type").asText("")) {
        case "text" -> {
          flushRun(out, thoughtRun, true);
          textRun.append(block.path("text").asText(""));
        }
        case "thinking" -> {
          flushRun(out, textRun, false);
          thoughtRun.append(
              firstNonBlank(block.path("thinking").asText(""), block.path("text").asText("")));
        }
        case "tool_use", "tool_call" -> {
          flushRun(out, textRun, false);
          flushRun(out, thoughtRun, true);
          String toolCallId =
              firstNonBlank(block.path("id").asText(""), block.path("toolCallId").asText(""));
          out.add(toolUseLine(toolCallId, firstNonBlank(block.path("name").asText(""), "tool")));
        }
        default -> {
          // ignore other block types (images handled elsewhere).
        }
      }
    }
    flushRun(out, textRun, false);
    flushRun(out, thoughtRun, true);
  }

  /** Emits a coalesced run — assistant text ({@code thinking=false}) or thought — and clears it. */
  private void flushRun(List<String> out, StringBuilder run, boolean thinking) {
    if (run.length() == 0) {
      return;
    }
    out.add(thinking ? thinkingLine(run.toString()) : assistantTextLine(run.toString()));
    run.setLength(0);
  }

  private String assistantTextLine(String text) {
    ObjectNode message = messageNode(assistantBlock("text", "text", text));
    return envelope(
        "assistant", message, KimiChatUuids.forMessage(uuidScope(), "a", assistantIdx++));
  }

  private String thinkingLine(String text) {
    ObjectNode message = messageNode(assistantBlock("thinking", "thinking", text));
    return envelope("assistant", message, KimiChatUuids.forMessage(uuidScope(), "t", thoughtIdx++));
  }

  private String userLine(String text) {
    ObjectNode message = messageNode(assistantBlock("text", "text", text));
    return envelope("user", message, KimiChatUuids.forMessage(uuidScope(), "u", userIdx++));
  }

  private String toolUseLine(String toolCallId, String name) {
    ObjectNode block = mapper.createObjectNode();
    block.put("type", "tool_use");
    block.put("id", toolCallId);
    block.put("name", name);
    return envelope("assistant", messageNode(block), KimiChatUuids.forToolCall(toolCallId));
  }

  private String toolResultLine(String toolCallId, String text, boolean error) {
    ObjectNode block = mapper.createObjectNode();
    block.put("type", "tool_result");
    block.put("content", text);
    if (error) {
      block.put("is_error", true);
    }
    return envelope("user", messageNode(block), KimiChatUuids.forToolResult(toolCallId));
  }

  private String resultLine() {
    ObjectNode node = mapper.createObjectNode();
    node.put("type", "result");
    node.put("subtype", "end_turn");
    stampSession(node);
    return node.toString();
  }

  private ObjectNode assistantBlock(String type, String field, String value) {
    ObjectNode block = mapper.createObjectNode();
    block.put("type", type);
    block.put(field, value);
    return block;
  }

  private ObjectNode messageNode(ObjectNode block) {
    ObjectNode message = mapper.createObjectNode();
    ArrayNode content = message.putArray("content");
    content.add(block);
    return message;
  }

  private String envelope(String type, ObjectNode message, String uuid) {
    ObjectNode node = mapper.createObjectNode();
    node.put("type", type);
    node.set("message", message);
    node.put("uuid", uuid);
    stampSession(node);
    return node.toString();
  }

  private void stampSession(ObjectNode node) {
    if (sessionId != null) {
      node.put("sessionId", sessionId);
    }
    if (sidechainAgentId != null) {
      node.put("isSidechain", true);
      node.put("agentId", sidechainAgentId);
    }
  }

  private String sid() {
    return sessionId == null ? "" : sessionId;
  }

  /** The uuid-minting scope: the session, plus the sidechain id so indices never collide. */
  private String uuidScope() {
    return sidechainAgentId == null ? sid() : sid() + "/" + sidechainAgentId;
  }

  // --- content extraction ----------------------------------------------------------------------

  /** The text of a single ACP content block ({@code {type:"text", text}}). */
  private static String textOf(JsonNode contentBlock) {
    if (contentBlock == null) {
      return "";
    }
    if (contentBlock.isTextual()) {
      return contentBlock.asText();
    }
    return contentBlock.path("text").asText("");
  }

  /** Flattened text of a message's {@code content} — a bare string or an array of text blocks. */
  private static String plainText(JsonNode content) {
    if (content == null) {
      return "";
    }
    if (content.isTextual()) {
      return content.asText();
    }
    StringBuilder sb = new StringBuilder();
    if (content.isArray()) {
      for (JsonNode block : content) {
        if ("text".equals(block.path("type").asText(""))) {
          sb.append(block.path("text").asText(""));
        } else if (block.isTextual()) {
          sb.append(block.asText());
        }
      }
    }
    return sb.toString();
  }

  /**
   * Flattened text of an ACP {@code tool_call_update.content} — an array of {@code ToolCallContent}
   * ({@code {type:"content", content:{type:"text", text}}}) or a bare content block.
   */
  private static String toolContentText(JsonNode content) {
    if (content == null || content.isNull()) {
      return "";
    }
    if (content.isTextual()) {
      return content.asText();
    }
    StringBuilder sb = new StringBuilder();
    if (content.isArray()) {
      for (JsonNode item : content) {
        JsonNode inner = item.has("content") ? item.path("content") : item;
        sb.append(textOf(inner));
      }
    } else {
      JsonNode inner = content.has("content") ? content.path("content") : content;
      sb.append(textOf(inner));
    }
    return sb.toString();
  }

  private static String firstNonBlank(String a, String b) {
    return a != null && !a.isBlank() ? a : b;
  }
}
