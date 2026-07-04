package eu.wohlben.qits.domain.command.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeMap;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link ChatSession}'s full-transcript restore: {@code attach} replays the
 * persisted head (from the {@link CommandLogReader}) plus the in-memory ring with an exact seam —
 * no gap, no overlap — and lines are persisted whole (the old 64 KB truncation corrupted large
 * events into invalid JSON). Lines are driven synchronously through {@code sendUser}'s echo, so no
 * real process, reader thread, or database is involved.
 */
public class ChatSessionTest {

  /** In-memory writer+reader pair standing in for the async log pipeline, keyed by sequence. */
  private static final class FakeLog implements CommandLogWriter, CommandLogReader {
    final TreeMap<Long, String> lines = new TreeMap<>();
    final List<Long> headReads = new ArrayList<>();

    @Override
    public synchronized void append(
        String commandId, long sequence, LogChannel channel, String content, Instant timestamp) {
      lines.put(sequence, content);
    }

    @Override
    public synchronized List<String> linesBefore(String commandId, long sequenceExclusive) {
      headReads.add(sequenceExclusive);
      return List.copyOf(lines.headMap(sequenceExclusive).values());
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
  }

  /** A never-exiting stand-in process; stdin writes go to a buffer, stdout stays empty. */
  private static final class FakeProcess extends Process {
    private final ByteArrayOutputStream stdin = new ByteArrayOutputStream();

    @Override
    public OutputStream getOutputStream() {
      return stdin;
    }

    @Override
    public InputStream getInputStream() {
      return InputStream.nullInputStream();
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
    // container/runtime/grace are unused here — these tests drive lines synchronously via sendUser
    // and never terminate, so no container signalling occurs.
    return new ChatSession(
        "cmd-1",
        new FakeProcess(),
        null,
        null,
        0L,
        (commandId, exitCode, manual) -> {},
        () -> {},
        log,
        log);
  }

  @Test
  public void attachAfterRingEvictionReplaysPersistedHeadThenRingWithoutGapOrOverlap() {
    FakeLog log = new FakeLog();
    ChatSession session = newSession(log);

    // 20 × ~32 KB user echoes ≈ 640 KB — far past the 256 KB ring, so the head gets evicted.
    String filler = "x".repeat(32 * 1024);
    for (int i = 0; i < 20; i++) {
      session.sendUser(i + ":" + filler);
    }

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    String[] replayed = sink.received.toString().split("\n");
    assertEquals(20, replayed.length, "replay must contain every emitted line exactly once");
    for (int i = 0; i < 20; i++) {
      assertTrue(
          replayed[i].contains("\"" + i + ":"), "line " + i + " must be at replay position " + i);
    }
    assertEquals(1, log.headReads.size(), "the evicted head must come from the persisted log");
    assertTrue(log.headReads.get(0) > 0, "eviction must have happened for this test to mean much");
  }

  @Test
  public void attachBeforeEvictionReplaysRingOnlyAndThenStreamsLive() {
    FakeLog log = new FakeLog();
    ChatSession session = newSession(log);

    session.sendUser("hello");
    session.sendUser("world");

    CapturingSink sink = new CapturingSink();
    session.attach(sink);

    assertEquals(2, sink.received.toString().split("\n").length);
    assertTrue(log.headReads.isEmpty(), "nothing evicted, so no persisted-head read");

    session.sendUser("again");
    assertEquals(3, sink.received.toString().split("\n").length, "live line after replay");
  }

  @Test
  public void persistsLinesLargerThanTheOldTruncationCapAsValidJson() throws Exception {
    FakeLog log = new FakeLog();
    ChatSession session = newSession(log);

    String big = "y".repeat(100_000);
    session.sendUser(big);

    String persisted = log.lines.get(0L);
    assertTrue(persisted.length() > 64 * 1024, "line must be stored beyond the old 64 KB cap");
    assertEquals(
        big,
        new ObjectMapper().readTree(persisted).get("text").asText(),
        "persisted line must round-trip as valid JSON");
  }
}
