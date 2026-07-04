package eu.wohlben.qits.domain.command.control;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.jboss.logging.Logger;

/**
 * One live Claude Code <strong>chat</strong> process driven over the stream-json protocol on plain
 * pipes (not a PTY, which would corrupt line-delimited JSON). The registry counterpart of {@link
 * CommandSession}: same decoupled-from-any-connection model (a scrollback ring for re-attach, a
 * {@link CommandOutputSink} fan-out, {@link CommandLogWriter} persistence, an exit latch), but the
 * unit of streaming is a <em>JSON line</em>, not raw bytes.
 *
 * <p>Everything the client renders flows through one unified line stream: each event Claude emits
 * on stdout, plus a synthetic {@code {"type":"user","text":…}} echo for every message the user
 * sends. That single stream is ringed (for re-attach), broadcast (live), and persisted un-truncated
 * on {@link LogChannel#OUTPUT} (for replay of a finished session) — so live and replay render
 * identically. Re-attach restores the <em>entire</em> conversation: lines evicted from the ring are
 * read back from the persisted log via {@link CommandLogReader}, stitched to the ring tail by
 * sequence number.
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
  private final BufferedWriter stdin;
  private final CommandExitListener exitListener;
  private final Runnable onComplete;
  private final CommandLogWriter logWriter;
  private final CommandLogReader logReader;

  private final AtomicLong logSeq = new AtomicLong();
  private final Deque<RingLine> ring = new ArrayDeque<>();
  private int ringBytes;
  private final Deque<CommandOutputSink> sinks = new ArrayDeque<>();
  private final Object stdinLock = new Object();

  private volatile boolean terminatedManually;
  private final CountDownLatch finished = new CountDownLatch(1);
  private volatile int exitCode = -1;

  ChatSession(
      String commandId,
      Process process,
      String container,
      ContainerRuntime containers,
      long graceMillis,
      CommandExitListener exitListener,
      Runnable onComplete,
      CommandLogWriter logWriter,
      CommandLogReader logReader) {
    this.commandId = commandId;
    this.process = process;
    this.container = container;
    this.containers = containers;
    this.graceMillis = graceMillis;
    this.exitListener = exitListener;
    this.onComplete = onComplete;
    this.logWriter = logWriter;
    this.logReader = logReader;
    this.stdin =
        new BufferedWriter(
            new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8));
  }

  synchronized void addInitialSink(CommandOutputSink sink) {
    sinks.add(sink);
  }

  void startReader() {
    Thread t = new Thread(this::readLoop, "chat-" + commandId);
    t.setDaemon(true);
    t.start();
  }

  private void readLoop() {
    try (BufferedReader out =
        new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = out.readLine()) != null) {
        if (!line.isEmpty()) {
          emitLine(line);
        }
      }
    } catch (IOException e) {
      LOG.debugf(e, "Chat output pump ended for command %s", commandId);
    } finally {
      finish();
    }
  }

  /**
   * Sends a user turn: writes the stream-json user message to Claude, and echoes it into the
   * stream.
   */
  void sendUser(String text) {
    synchronized (stdinLock) {
      try {
        stdin.write(
            mapper.writeValueAsString(
                Map.of(
                    "type",
                    "user",
                    "message",
                    Map.of(
                        "role",
                        "user",
                        "content",
                        List.of(Map.of("type", "text", "text", text))))));
        stdin.write("\n");
        stdin.flush();
      } catch (IOException e) {
        LOG.debugf(e, "Chat stdin write failed for command %s", commandId);
        return;
      }
    }
    try {
      emitLine(mapper.writeValueAsString(Map.of("type", "user", "text", text)));
    } catch (IOException e) {
      LOG.debugf(e, "Chat user echo failed for command %s", commandId);
    }
  }

  /**
   * Ring + broadcast + persist a single JSON line of the unified conversation stream. Persisted
   * whole, however large — the log column is a CLOB, and truncation would corrupt the stored JSON.
   */
  private void emitLine(String line) {
    long seq;
    synchronized (this) {
      seq = logSeq.getAndIncrement();
      appendToRing(seq, line);
      broadcast(line + "\n");
    }
    if (logWriter != null) {
      logWriter.append(commandId, seq, LogChannel.OUTPUT, line, Instant.now());
    }
  }

  /**
   * Replays the entire conversation to a (re)connecting client — the persisted head (lines already
   * evicted from the ring) followed by the ring tail, stitched exactly at the first ring sequence —
   * then subscribes it for live lines. Holding the session lock throughout means no live line can
   * interleave mid-replay. Lines older than the ring head may still sit in the async write batch in
   * theory, but flushing (≤ 500 ms) beats eviction (256 KB of scrollback) in practice; that window
   * is accepted best-effort, like the writer itself.
   */
  synchronized void attach(CommandOutputSink sink) {
    StringBuilder replay = new StringBuilder();
    if (!ring.isEmpty()) {
      long firstRingSeq = ring.peekFirst().seq();
      if (logReader != null && firstRingSeq > 0) {
        for (String line : logReader.linesBefore(commandId, firstRingSeq)) {
          replay.append(line).append('\n');
        }
      }
      for (RingLine entry : ring) {
        replay.append(entry.line()).append('\n');
      }
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

  synchronized void detach(CommandOutputSink sink) {
    sinks.remove(sink);
  }

  void terminate() {
    terminatedManually = true;
    try {
      stdin.close();
    } catch (IOException ignored) {
      // best effort
    }
    // Killing the host-side `docker exec` client alone would orphan the claude process inside the
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
