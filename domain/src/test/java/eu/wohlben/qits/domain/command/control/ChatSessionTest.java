package eu.wohlben.qits.domain.command.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.control.CommandLogReader.TimedLine;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link ChatSession}'s persistence contract and full-conversation restore. The
 * durable record is the imported transcript ({@code TRANSCRIPT} channel, via {@link
 * CommandLogReader}); stdout interception persists only failure {@code result} events. {@code
 * attach} stitches the transcript head to the ring tail at the first ring line whose {@code uuid}
 * the transcript contains — no gap, no overlap. Lines are driven synchronously through {@code
 * sendUser}'s echo or a preloaded fake stdout, so no real process or database is involved.
 */
public class ChatSessionTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** In-memory writer+reader pair standing in for the log pipeline. */
  private static final class FakeLog implements CommandLogWriter, CommandLogReader {
    final TreeMap<Long, TimedLine> output = new TreeMap<>();
    List<TimedLine> transcript = List.of();
    final List<Long> outputHeadReads = new ArrayList<>();

    @Override
    public synchronized void append(
        String commandId, long sequence, LogChannel channel, String content, Instant timestamp) {
      output.put(sequence, new TimedLine(sequence, content, timestamp));
    }

    @Override
    public synchronized List<TimedLine> transcriptLines(String commandId) {
      return transcript;
    }

    @Override
    public synchronized List<TimedLine> outputLinesBefore(
        String commandId, long sequenceExclusive) {
      outputHeadReads.add(sequenceExclusive);
      return List.copyOf(output.headMap(sequenceExclusive).values());
    }
  }

  private static final class CapturingSink implements CommandOutputSink {
    final StringBuilder received = new StringBuilder();

    @Override
    public void write(String data) {
      received.append(data);
    }

    @Override
    public boolean isOpen() {
      return true;
    }

    List<String> lines() {
      String text = received.toString();
      return text.isEmpty() ? List.of() : List.of(text.split("\n"));
    }
  }

  /** A stand-in process; stdin writes go to a buffer, stdout serves the preloaded content. */
  private static final class FakeProcess extends Process {
    private final ByteArrayOutputStream stdin = new ByteArrayOutputStream();
    private final InputStream stdout;

    FakeProcess() {
      this("");
    }

    FakeProcess(String stdoutContent) {
      this.stdout = new ByteArrayInputStream(stdoutContent.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public OutputStream getOutputStream() {
      return stdin;
    }

    @Override
    public InputStream getInputStream() {
      return stdout;
    }

    @Override
    public InputStream getErrorStream() {
      return InputStream.nullInputStream();
    }

    @Override
    public int waitFor() {
      return 0;
    }

    @Override
    public int exitValue() {
      return 0;
    }

    @Override
    public void destroy() {}
  }

  private ChatSession newSession(FakeLog log) {
    return newSession(log, new FakeProcess());
  }

  private ChatSession newSession(FakeLog log, FakeProcess process) {
    // container/runtime/grace are unused here — these tests drive lines synchronously and never
    // terminate, so no container signalling occurs. The transport is Claude's stream-json
    // pass-through, which is what the preloaded stdout + sendUser echoes exercise.
    return new ChatSession(
        "cmd-1",
        process,
        null,
        null,
        0L,
        new StreamJsonChatProtocol(process, "cmd-1"),
        (commandId, exitCode, manual) -> {},
        () -> {},
        log,
        log);
  }

  /** Feeds the preloaded stdout through the reader thread and waits for it to drain. */
  private ChatSession drainStdout(FakeLog log, String... stdoutLines) {
    ChatSession session = newSession(log, new FakeProcess(String.join("\n", stdoutLines) + "\n"));
    session.startReader();
    assertEquals(0, session.awaitExit(5_000), "the fake stdout must drain");
    return session;
  }

  private static String assistantEvent(String uuid, String text) {
    return "{\"type\":\"assistant\",\"uuid\":\""
        + uuid
        + "\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\""
        + text
        + "\"}]}}";
  }

  /** The wrapped persistence shape of an extracted transcript line. */
  private static String transcriptAssistant(String uuid, String text, String timestamp) {
    return "{\"parentUuid\":null,\"sessionId\":\"s1\",\"isSidechain\":false,\"timestamp\":\""
        + timestamp
        + "\",\"type\":\"assistant\",\"uuid\":\""
        + uuid
        + "\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\""
        + text
        + "\"}]}}";
  }

  private static String transcriptUser(String text, String timestamp) {
    return "{\"parentUuid\":null,\"sessionId\":\"s1\",\"isSidechain\":false,\"timestamp\":\""
        + timestamp
        + "\",\"type\":\"user\",\"uuid\":\"uu-user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\""
        + text
        + "\"}]}}";
  }

  private static TimedLine timed(long seq, String content, String timestamp) {
    return new TimedLine(seq, content, Instant.parse(timestamp));
  }

  @Test
  public void ordinaryLinesWriteNoOutputRows() {
    FakeLog log = new FakeLog();
    ChatSession session = drainStdout(log, assistantEvent("uu1", "hello"));

    session.sendUser("a user turn");

    assertTrue(log.output.isEmpty(), "neither echoes nor ordinary events may persist to OUTPUT");
  }

  @Test
  public void errorResultsArePersistedWholeOnOutput() throws Exception {
    FakeLog log = new FakeLog();
    String bigError = "y".repeat(100_000);
    drainStdout(
        log,
        "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"fine\"}",
        "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\""
            + bigError
            + "\"}");

    assertEquals(1, log.output.size(), "only the failure result may persist");
    String persisted = log.output.firstEntry().getValue().content();
    assertTrue(persisted.length() > 64 * 1024, "stored beyond the old 64 KB cap");
    assertEquals(
        bigError,
        MAPPER.readTree(persisted).get("result").asText(),
        "persisted line must round-trip as valid JSON");
  }

  @Test
  public void attachWithEmptyTranscriptReplaysRingOnlyAndThenStreamsLive() {
    FakeLog log = new FakeLog();
    ChatSession session = newSession(log);
    // The transport binds its wire on start (as spawnChat does before any turn); an empty fake
    // stdout drains immediately, leaving the ring/echo path to drive the rest synchronously.
    session.startReader();

    session.sendUser("hello");
    session.sendUser("world");

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    assertEquals(2, sink.lines().size());
    assertTrue(log.outputHeadReads.isEmpty(), "nothing evicted, so no persisted-error read");

    session.sendUser("again");
    assertEquals(3, sink.lines().size(), "live line after replay");
  }

  @Test
  public void attachWithEmptyTranscriptPrefixesEvictedErrorResults() {
    FakeLog log = new FakeLog();
    ChatSession session =
        drainStdout(
            log,
            "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"boom\"}");

    // ~640 KB of echoes evict the error line from the 256 KB ring.
    String filler = "x".repeat(32 * 1024);
    for (int i = 0; i < 20; i++) {
      session.sendUser(i + ":" + filler);
    }

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    List<String> replayed = sink.lines();
    assertTrue(replayed.get(0).contains("\"boom\""), "the evicted error must lead the replay");
    assertEquals(1, log.outputHeadReads.size());
  }

  @Test
  public void attachStitchesTranscriptHeadToRingAtTheSharedUuid() {
    FakeLog log = new FakeLog();
    log.transcript =
        List.of(
            timed(
                1L << 40,
                transcriptUser("first question", "2026-07-10T08:00:00Z"),
                "2026-07-10T08:00:00Z"),
            timed(
                (1L << 40) + 1,
                transcriptAssistant("uu1", "first answer", "2026-07-10T08:00:05Z"),
                "2026-07-10T08:00:05Z"));
    ChatSession session =
        drainStdout(log, assistantEvent("uu1", "first answer"), assistantEvent("uu2", "second"));

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    List<String> replayed = sink.lines();
    assertEquals(3, replayed.size(), "transcript head + ring from the seam, exactly once each");
    assertTrue(replayed.get(0).contains("first question"), "the real user turn leads the head");
    assertTrue(replayed.get(0).contains("parentUuid"), "the head line is transcript-shaped");
    assertEquals(assistantEvent("uu1", "first answer"), replayed.get(1), "ring takes over at uu1");
    assertEquals(assistantEvent("uu2", "second"), replayed.get(2));
  }

  @Test
  public void attachAfterRingEvictionRestoresTheFullConversationFromTheTranscript() {
    FakeLog log = new FakeLog();
    String filler = "x".repeat(32 * 1024);
    String[] stdout = new String[20];
    List<TimedLine> transcript = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
      String uuid = String.format("uu%02d", i);
      stdout[i] = assistantEvent(uuid, i + ":" + filler);
      transcript.add(
          timed(
              (1L << 40) + i,
              transcriptAssistant(uuid, i + ":" + filler, "2026-07-10T08:00:00Z"),
              "2026-07-10T08:00:00Z"));
    }
    log.transcript = List.copyOf(transcript);
    ChatSession session = drainStdout(log, stdout);

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    List<String> replayed = sink.lines();
    assertEquals(20, replayed.size(), "every event exactly once despite ring eviction");
    for (int i = 0; i < 20; i++) {
      String uuid = "\"uuid\":\"" + String.format("uu%02d", i) + "\"";
      assertTrue(
          replayed.get(i).contains(uuid), "event " + i + " must sit at replay position " + i);
    }
  }

  @Test
  public void attachWithoutSharedUuidSkipsEchoesTheTranscriptAlreadyCovers() {
    FakeLog log = new FakeLog();
    ChatSession session = newSession(log);
    session.startReader();

    session.sendUser("hello");
    session.sendUser("queued mid-turn");
    session.sendUser("not yet imported");
    // "hello" persisted as a real user line; "queued mid-turn" as a queued_command attachment
    // (how the harness stores a turn sent while the agent was busy) — both cover their echoes.
    log.transcript =
        List.of(
            timed(
                1L << 40, transcriptUser("hello", "2026-07-10T08:00:00Z"), "2026-07-10T08:00:00Z"),
            timed(
                (1L << 40) + 1,
                "{\"sessionId\":\"s1\",\"timestamp\":\"2026-07-10T08:00:02Z\",\"type\":\"attachment\","
                    + "\"uuid\":\"uu-att\",\"attachment\":{\"type\":\"queued_command\","
                    + "\"prompt\":[{\"type\":\"text\",\"text\":\"queued mid-turn\"}]}}",
                "2026-07-10T08:00:02Z"),
            timed(
                (1L << 40) + 2,
                transcriptAssistant("uu9", "hi there", "2026-07-10T08:00:05Z"),
                "2026-07-10T08:00:05Z"));

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    List<String> replayed = sink.lines();
    assertEquals(4, replayed.size(), "covered echoes skipped, uncovered echo kept");
    assertTrue(replayed.get(0).contains("\"hello\""));
    assertTrue(replayed.get(1).contains("queued mid-turn"));
    assertTrue(replayed.get(2).contains("hi there"));
    assertTrue(replayed.get(3).contains("not yet imported"));
    assertFalse(
        replayed.stream().filter(line -> line.contains("\"hello\"")).count() > 1,
        "the covered user turn must not double-render");
  }

  @Test
  public void attachMergesPersistedErrorResultsIntoTheTranscriptHead() {
    FakeLog log = new FakeLog();
    log.transcript =
        List.of(
            timed(
                1L << 40,
                transcriptUser("first question", "2026-07-10T08:00:00Z"),
                "2026-07-10T08:00:00Z"),
            timed(
                (1L << 40) + 1,
                transcriptAssistant("uu1", "second try", "2026-07-10T08:00:05Z"),
                "2026-07-10T08:00:05Z"));
    // The error (seq 0) precedes the seam line (uu1, seq 1) on stdout, so it merges into the head.
    ChatSession session =
        drainStdout(
            log,
            "{\"type\":\"result\",\"subtype\":\"error\",\"is_error\":true,\"result\":\"boom\"}",
            assistantEvent("uu1", "second try"));

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    List<String> replayed = sink.lines();
    assertEquals(3, replayed.size(), "head + merged error + ring from the seam, exactly once each");
    assertTrue(replayed.get(0).contains("first question"));
    assertTrue(replayed.get(1).contains("\"boom\""), "the pre-seam error slots into the head");
    assertEquals(assistantEvent("uu1", "second try"), replayed.get(2));
  }
}
