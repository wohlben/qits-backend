package eu.wohlben.qits.domain.command.control;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.jboss.logging.Logger;

/**
 * One live coding-agent <strong>chat</strong> process on plain pipes (not a PTY, which would
 * corrupt line-delimited JSON), driven through a pluggable {@link ChatProtocol} — Claude's
 * stream-json pass-through ({@link StreamJsonChatProtocol}) or Kimi's ACP JSON-RPC client, both
 * normalizing to the same envelope. The registry counterpart of {@link CommandSession}: same
 * decoupled-from-any-connection model (a scrollback ring for re-attach, a {@link CommandOutputSink}
 * fan-out, {@link CommandLogWriter} persistence, an exit latch), but the unit of streaming is a
 * <em>JSON line</em>, not raw bytes.
 *
 * <p>Everything the client renders flows through one unified line stream: each event the protocol
 * emits, plus a synthetic {@code {"type":"user","text":…}} echo for every message the user sends.
 * That single stream is ringed (for re-attach) and broadcast (live) — stream interception is the
 * <em>live transport</em>. The durable record is the imported agent transcript on {@link
 * LogChannel#TRANSCRIPT} (live tail during the run, reconciling sweep on exit); the only stdout
 * lines still persisted are failure {@code result} events, which the harness never writes to its
 * transcript, kept as {@link LogChannel#OUTPUT} rows so error bubbles survive replay. Re-attach
 * restores the <em>entire</em> conversation: the transcript head is stitched to the ring tail at
 * the first ring line whose {@code uuid} the transcript already contains (stream-json events and
 * transcript lines share uuids), so every event replays exactly once.
 */
final class ChatSession {

  private static final Logger LOG = Logger.getLogger(ChatSession.class);

  /**
   * How much recent conversation (in bytes of JSONL) to retain in memory. Only the tail — {@link
   * #attach} restores anything older from the persisted log.
   */
  private static final int RING_CAPACITY_BYTES = 256 * 1024;

  /** One retained line of the unified stream, tagged with its persistence sequence number. */
  private record RingLine(long seq, String line) {}

  private final ObjectMapper mapper = new ObjectMapper();
  private final String commandId;
  private final Process process;
  private final String container;
  private final ContainerRuntime containers;
  private final long graceMillis;
  private final ChatProtocol protocol;
  private final CommandExitListener exitListener;
  private final Runnable onComplete;
  private final CommandLogWriter logWriter;
  private final CommandLogReader logReader;

  private final AtomicLong logSeq = new AtomicLong();
  private final Deque<RingLine> ring = new ArrayDeque<>();
  private int ringBytes;
  private final Deque<CommandOutputSink> sinks = new ArrayDeque<>();

  private volatile boolean terminatedManually;
  private final CountDownLatch finished = new CountDownLatch(1);
  private volatile int exitCode = -1;

  ChatSession(
      String commandId,
      Process process,
      String container,
      ContainerRuntime containers,
      long graceMillis,
      ChatProtocol protocol,
      CommandExitListener exitListener,
      Runnable onComplete,
      CommandLogWriter logWriter,
      CommandLogReader logReader) {
    this.commandId = commandId;
    this.process = process;
    this.container = container;
    this.containers = containers;
    this.graceMillis = graceMillis;
    this.protocol = protocol;
    this.exitListener = exitListener;
    this.onComplete = onComplete;
    this.logWriter = logWriter;
    this.logReader = logReader;
  }

  synchronized void addInitialSink(CommandOutputSink sink) {
    sinks.add(sink);
  }

  /**
   * Starts the transport: the protocol pumps the process output through {@link #emitLine} and
   * latches the exit via {@link #finish} when the stream closes.
   */
  void startReader() {
    protocol.start(this::emitLine, this::finish);
  }

  /** Sends a user turn through the transport (which also echoes it into the stream). */
  void sendUser(String text) {
    protocol.sendUser(text);
  }

  /**
   * Ring + broadcast a single JSON line of the unified conversation stream. Only failure {@code
   * result} events are persisted (whole, however large — the log column is a CLOB): they are absent
   * from the harness transcript, and everything else is durably covered by the transcript import.
   */
  private void emitLine(String line) {
    long seq;
    synchronized (this) {
      seq = logSeq.getAndIncrement();
      appendToRing(seq, line);
      broadcast(line + "\n");
    }
    if (logWriter != null && ErrorResultLines.isErrorResult(line)) {
      logWriter.append(commandId, seq, LogChannel.OUTPUT, line, Instant.now());
    }
  }

  /**
   * Replays the entire conversation to a (re)connecting client — the durable head (imported
   * transcript lines, merged with any persisted error results) followed by the ring tail — then
   * subscribes it for live lines. The seam is exact: the first ring line whose {@code uuid} the
   * transcript already contains marks where the ring takes over; everything before it comes from
   * the transcript (which also covers the real user turns whose ring echoes predate the seam).
   * Holding the session lock throughout means no live line can interleave mid-replay. Freshness of
   * the head is the live tail's poll cadence; a ring line not yet imported is simply served from
   * the ring — the seam scan tolerates any tail lag.
   */
  synchronized void attach(CommandOutputSink sink) {
    StringBuilder replay = new StringBuilder();
    List<CommandLogReader.TimedLine> transcript =
        logReader != null ? logReader.transcriptLines(commandId) : List.of();
    if (transcript.isEmpty()) {
      // Nothing imported yet: today's ring-only replay, prefixed by any error results the ring
      // already evicted (their OUTPUT sequences share the ring's space, so the bound is exact).
      if (!ring.isEmpty()) {
        long firstRingSeq = ring.peekFirst().seq();
        if (logReader != null && firstRingSeq > 0) {
          for (CommandLogReader.TimedLine error :
              logReader.outputLinesBefore(commandId, firstRingSeq)) {
            replay.append(error.content()).append('\n');
          }
        }
        for (RingLine entry : ring) {
          replay.append(entry.line()).append('\n');
        }
      }
    } else {
      appendStitched(replay, transcript);
    }
    if (!replay.isEmpty()) {
      try {
        sink.write(replay.toString());
      } catch (RuntimeException e) {
        LOG.debugf(e, "Chat replay failed for command %s", commandId);
        return;
      }
    }
    sinks.add(sink);
  }

  /** Transcript head + ring tail, stitched at the first ring line the transcript contains. */
  private void appendStitched(StringBuilder replay, List<CommandLogReader.TimedLine> transcript) {
    Map<String, Integer> transcriptIndexByUuid = new HashMap<>();
    for (int i = 0; i < transcript.size(); i++) {
      String uuid = uuidOf(transcript.get(i).content());
      if (uuid != null) {
        transcriptIndexByUuid.putIfAbsent(uuid, i);
      }
    }
    int seamIndex = -1;
    long seamSeq = -1;
    int seamRingPos = -1;
    int pos = 0;
    for (RingLine entry : ring) {
      Integer index = transcriptIndexByUuid.get(uuidOf(entry.line()));
      if (index != null) {
        seamIndex = index;
        seamSeq = entry.seq();
        seamRingPos = pos;
        break;
      }
      pos++;
    }
    if (seamIndex >= 0) {
      // Exact seam: transcript strictly before it, ring from it onward. Ring lines before the
      // seam are stdout-only shapes (init, thinking budget, rate limits, user echoes) whose
      // durable counterparts — where any exist — sit in the served transcript head.
      appendMerged(replay, transcript.subList(0, seamIndex), errorResultsBefore(seamSeq));
      int i = 0;
      for (RingLine entry : ring) {
        if (i++ >= seamRingPos) {
          replay.append(entry.line()).append('\n');
        }
      }
    } else {
      // No shared uuid (tail lag, or the ring holds only echoes/noise): serve everything from
      // both, skipping only synthetic user echoes the transcript head already covers. Residual
      // double-render here is best-effort territory (256 KB of ring vs one poll interval).
      long bound = ring.isEmpty() ? Long.MAX_VALUE : ring.peekFirst().seq();
      appendMerged(replay, transcript, errorResultsBefore(bound));
      Set<String> servedUserTexts = userTexts(transcript);
      for (RingLine entry : ring) {
        String echoText = syntheticEchoText(entry.line());
        if (echoText != null && servedUserTexts.contains(echoText)) {
          continue;
        }
        replay.append(entry.line()).append('\n');
      }
    }
  }

  private List<CommandLogReader.TimedLine> errorResultsBefore(long sequenceExclusive) {
    return sequenceExclusive > 0
        ? logReader.outputLinesBefore(commandId, sequenceExclusive)
        : List.of();
  }

  /**
   * Interleaves persisted error results into the transcript head by timestamp — both carry wall
   * clocks of the same host, and errors sit at turn boundaries seconds apart, so ordering is safe.
   */
  private void appendMerged(
      StringBuilder replay,
      List<CommandLogReader.TimedLine> transcriptHead,
      List<CommandLogReader.TimedLine> errors) {
    int e = 0;
    for (CommandLogReader.TimedLine line : transcriptHead) {
      while (e < errors.size() && !errors.get(e).timestamp().isAfter(line.timestamp())) {
        replay.append(errors.get(e++).content()).append('\n');
      }
      replay.append(line.content()).append('\n');
    }
    while (e < errors.size()) {
      replay.append(errors.get(e++).content()).append('\n');
    }
  }

  /** The top-level {@code uuid} of a stream/transcript line, or null (echoes, noise, non-JSON). */
  private String uuidOf(String line) {
    JsonNode node = parseQuietly(line);
    JsonNode uuid = node != null ? node.get("uuid") : null;
    return uuid != null && uuid.isTextual() ? uuid.asText() : null;
  }

  /** The text of a synthetic qits user echo ({@code {"type":"user","text":…}}), else null. */
  private String syntheticEchoText(String line) {
    JsonNode node = parseQuietly(line);
    if (node == null || !"user".equals(node.path("type").asText())) {
      return null;
    }
    JsonNode text = node.get("text");
    return text != null && text.isTextual() ? text.asText() : null;
  }

  /**
   * Every user-turn text in the transcript: {@code user} lines (string content, or text blocks
   * joined) and {@code queued_command} attachments (how the harness persists a turn sent while the
   * agent was mid-turn).
   */
  private Set<String> userTexts(List<CommandLogReader.TimedLine> transcript) {
    Set<String> texts = new HashSet<>();
    for (CommandLogReader.TimedLine line : transcript) {
      JsonNode node = parseQuietly(line.content());
      if (node == null) {
        continue;
      }
      String type = node.path("type").asText();
      if ("user".equals(type)) {
        JsonNode content = node.path("message").path("content");
        if (content.isTextual()) {
          texts.add(content.asText());
        } else {
          addJoinedTextBlocks(texts, content);
        }
      } else if ("attachment".equals(type)
          && "queued_command".equals(node.path("attachment").path("type").asText())) {
        addJoinedTextBlocks(texts, node.path("attachment").path("prompt"));
      }
    }
    return texts;
  }

  private static void addJoinedTextBlocks(Set<String> texts, JsonNode blocks) {
    if (!blocks.isArray()) {
      return;
    }
    StringBuilder joined = new StringBuilder();
    for (JsonNode block : blocks) {
      if ("text".equals(block.path("type").asText())) {
        joined.append(block.path("text").asText());
      }
    }
    if (!joined.isEmpty()) {
      texts.add(joined.toString());
    }
  }

  private JsonNode parseQuietly(String line) {
    try {
      return mapper.readTree(line);
    } catch (JsonProcessingException e) {
      return null;
    }
  }

  synchronized void detach(CommandOutputSink sink) {
    sinks.remove(sink);
  }

  void terminate() {
    terminatedManually = true;
    // Close the transport first (stdin/EOF, plus any protocol-level cancel), so the agent sees the
    // session end cleanly before we escalate to signals.
    protocol.close();
    // Killing the host-side `docker exec` client alone would orphan the agent process inside the
    // container, so signal its process group (recorded under setsid to a pid file), escalating to
    // SIGKILL after the grace period.
    killGroup("TERM");
    if (awaitExit(graceMillis) < 0) {
      killGroup("KILL");
    }
    process.destroy();
    awaitExit(TimeUnit.SECONDS.toMillis(2));
  }

  /**
   * Read the launched script's pgid from its pid file and signal that group inside the container.
   */
  private boolean killGroup(String signal) {
    ContainerRuntime.ExecResult pid =
        containers.exec(container, null, Map.of(), "cat", "/tmp/qits-cmd-" + commandId + ".pid");
    if (pid.exitCode() != 0 || pid.output().isBlank()) {
      return false;
    }
    String pgid = pid.output().trim();
    // The pid file is written by the (untrusted) container, so accept only a plain number before
    // interpolating it into a shell line. `kill` runs via `sh -c` (the shell builtin) so it works
    // even in an image without a /bin/kill; the signal name is a controlled, validated value.
    if (!pgid.matches("\\d+")) {
      return false;
    }
    ContainerRuntime.ExecResult result =
        containers.exec(
            container, null, Map.of(), "sh", "-c", "kill -s " + signal + " -- -" + pgid);
    return result.exitCode() == 0;
  }

  boolean isAlive() {
    return process.isAlive();
  }

  int awaitExit(long timeoutMillis) {
    try {
      if (finished.await(timeoutMillis, TimeUnit.MILLISECONDS)) {
        return exitCode;
      }
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    return -1;
  }

  private void appendToRing(long seq, String line) {
    ring.add(new RingLine(seq, line));
    ringBytes += line.length();
    while (ringBytes > RING_CAPACITY_BYTES && ring.size() > 1) {
      ringBytes -= ring.removeFirst().line().length();
    }
  }

  private void broadcast(String text) {
    for (Iterator<CommandOutputSink> it = sinks.iterator(); it.hasNext(); ) {
      CommandOutputSink sink = it.next();
      if (!sink.isOpen()) {
        it.remove();
        continue;
      }
      try {
        sink.write(text);
      } catch (RuntimeException e) {
        it.remove();
      }
    }
  }

  private void finish() {
    try {
      exitCode = process.waitFor();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    try {
      exitListener.onExit(commandId, exitCode, terminatedManually);
    } catch (RuntimeException e) {
      LOG.errorf(e, "Exit listener failed for chat command %s", commandId);
    } finally {
      onComplete.run();
      finished.countDown();
    }
  }
}
