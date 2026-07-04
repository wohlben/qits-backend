package eu.wohlben.qits.domain.command.control;

import com.pty4j.PtyProcess;
import com.pty4j.WinSize;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.jboss.logging.Logger;

/**
 * One live PTY process, decoupled from any client connection. A single daemon reader thread drains
 * the PTY's merged stdout/stderr and, under the session monitor, both appends to a bounded
 * raw-output ring buffer (for replay on re-attach) and fans the chunk out to every attached {@link
 * CommandOutputSink}. Sinks attach and detach freely while the process keeps running; nothing about
 * the process lifecycle is tied to a connection. The process ends only by exiting itself or via
 * {@link #terminate()}.
 *
 * <p>Output broadcast happens under the monitor so a freshly attached sink — which replays the ring
 * buffer and is added under the same monitor — never interleaves replayed and live output. The cost
 * is that a stuck client briefly stalls the pump; dead sinks are pruned on the next write.
 */
final class CommandSession {

  private static final Logger LOG = Logger.getLogger(CommandSession.class);

  /** How much recent raw output to retain for replay on re-attach. */
  private static final int RING_CAPACITY_BYTES = 256 * 1024;

  /** A runaway no-newline line is truncated to this many characters when persisted. */
  private static final int MAX_LOG_LINE_CHARS = 16 * 1024;

  private final String commandId;
  private final PtyProcess process;

  /** The container the launched script runs inside, and the runtime used to signal it. */
  private final String container;

  private final ContainerRuntime containers;
  private final long graceMillis;

  private final CommandExitListener exitListener;
  private final Runnable onComplete;

  /** Persists captured lines (may be null to disable logging); see line-framing below. */
  private final CommandLogWriter logWriter;

  /** Monotonic ordinal shared by both channels, so the log has a stable total order. */
  private final AtomicLong logSeq = new AtomicLong();

  /** In-progress OUTPUT line (reader thread only) and STDIN line (under {@link #stdinLock}). */
  private final StringBuilder outLine = new StringBuilder();

  private final StringBuilder inLine = new StringBuilder();

  /** Recent raw output chunks, total bounded by {@link #RING_CAPACITY_BYTES}, for replay. */
  private final Deque<byte[]> ring = new ArrayDeque<>();

  private int ringBytes;

  /** Attached output destinations; mutated and iterated only under the session monitor. */
  private final Deque<CommandOutputSink> sinks = new ArrayDeque<>();

  /** Serializes stdin writes from concurrent clients so their bytes don't interleave. */
  private final Object stdinLock = new Object();

  private volatile boolean terminatedManually;
  private Thread reader;

  /**
   * Signalled once the reader has computed the authoritative exit code and run the exit listener.
   */
  private final CountDownLatch finished = new CountDownLatch(1);

  private volatile int exitCode = -1;

  CommandSession(
      String commandId,
      PtyProcess process,
      String container,
      ContainerRuntime containers,
      long graceMillis,
      CommandExitListener exitListener,
      Runnable onComplete,
      CommandLogWriter logWriter) {
    this.commandId = commandId;
    this.process = process;
    this.container = container;
    this.containers = containers;
    this.graceMillis = graceMillis;
    this.exitListener = exitListener;
    this.onComplete = onComplete;
    this.logWriter = logWriter;
  }

  /** Adds a sink before the reader starts (no replay needed — the ring is still empty). */
  synchronized void addInitialSink(CommandOutputSink sink) {
    sinks.add(sink);
  }

  void startReader() {
    Thread t = new Thread(this::readLoop, "command-" + commandId);
    t.setDaemon(true);
    this.reader = t;
    t.start();
  }

  private void readLoop() {
    byte[] buffer = new byte[4096];
    try (InputStream in = process.getInputStream()) {
      int read;
      while ((read = in.read(buffer)) != -1) {
        String text = new String(buffer, 0, read, StandardCharsets.UTF_8);
        synchronized (this) {
          appendToRing(buffer, read);
          broadcast(text);
        }
        // Raw bytes still drive xterm (above); the framer additionally captures completed lines for
        // the audit log. Done outside the monitor — outLine is touched only by this reader thread.
        frameOutput(text);
      }
    } catch (Exception e) {
      LOG.debugf(e, "Output pump ended for command %s", commandId);
    } finally {
      finish();
    }
  }

  /** Attach a live client: replay the buffered scrollback, then start receiving live output. */
  synchronized void attach(CommandOutputSink sink) {
    if (ringBytes > 0) {
      byte[] snapshot = new byte[ringBytes];
      int pos = 0;
      for (byte[] chunk : ring) {
        System.arraycopy(chunk, 0, snapshot, pos, chunk.length);
        pos += chunk.length;
      }
      try {
        sink.write(new String(snapshot, StandardCharsets.UTF_8));
      } catch (RuntimeException e) {
        LOG.debugf(e, "Replay failed for command %s", commandId);
        return;
      }
    }
    sinks.add(sink);
  }

  synchronized void detach(CommandOutputSink sink) {
    sinks.remove(sink);
  }

  /** Forward a client's keystrokes to the process stdin. */
  void input(byte[] data) {
    synchronized (stdinLock) {
      try {
        OutputStream out = process.getOutputStream();
        out.write(data);
        out.flush();
      } catch (IOException e) {
        LOG.debugf(e, "stdin write failed for command %s", commandId);
      }
      frameInput(new String(data, StandardCharsets.UTF_8));
    }
  }

  void resize(int cols, int rows) {
    try {
      process.setWinSize(new WinSize(cols, rows));
    } catch (RuntimeException e) {
      LOG.debugf(e, "resize failed for command %s", commandId);
    }
  }

  /**
   * Send a named signal (e.g. TERM, INT) to the launched script's process <em>group</em> inside the
   * container. The script runs under {@code setsid} as a session/group leader with its pgid written
   * to a pid file, so {@code kill -- -pgid} reaches a compound script's children too. Killing the
   * host-side {@code docker exec} client instead would orphan the process alive — this is the
   * graceful half of a daemon stop; {@link #terminate()} stays the kill fallback. Returns false if
   * the signal could not be delivered.
   */
  boolean signal(String signal) {
    return killGroup(signal);
  }

  /**
   * Force-kill the containerized process. Killing the host-side {@code docker exec} client does not
   * kill the process inside the container — so signal the group SIGTERM, escalate to SIGKILL after
   * the grace period, and fall back to restarting the container if even that leaves it running. The
   * host client is then destroyed and its streams closed to unblock the reader's native {@code
   * read()}.
   */
  void terminate() {
    terminatedManually = true;
    killGroup("TERM");
    if (awaitExit(graceMillis) < 0) {
      killGroup("KILL");
      if (awaitExit(TimeUnit.SECONDS.toMillis(2)) < 0) {
        // Nothing reached the process (e.g. no pid file): restart the container as a last resort.
        containers.restart(container);
      }
    }
    process.destroyForcibly();
    try {
      process.getInputStream().close();
      process.getOutputStream().close();
    } catch (IOException ignored) {
      // Best-effort: the process is already being killed.
    }
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

  /**
   * Block until the reader has finished and computed the exit code (or the timeout elapses).
   * Returns the authoritative exit code, or -1 if it is still running when the timeout elapses.
   * Waiting on the reader's latch — rather than {@code process.exitValue()} — avoids the race where
   * the PTY hits EOF before the OS process is reaped, which would make {@code exitValue()} throw.
   */
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

  private void appendToRing(byte[] buffer, int read) {
    byte[] chunk = new byte[read];
    System.arraycopy(buffer, 0, chunk, 0, read);
    ring.add(chunk);
    ringBytes += read;
    while (ringBytes > RING_CAPACITY_BYTES && ring.size() > 1) {
      ringBytes -= ring.removeFirst().length;
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
    flushPartialLines();
    exitCode = blockingExitCode();
    try {
      exitListener.onExit(commandId, exitCode, terminatedManually);
    } catch (RuntimeException e) {
      LOG.errorf(e, "Exit listener failed for command %s", commandId);
    } finally {
      onComplete.run();
      finished.countDown();
    }
  }

  /**
   * Block until the OS process is reaped so the exit code is reliable (PTY EOF can precede
   * reaping).
   */
  private int blockingExitCode() {
    try {
      return process.waitFor();
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return safeExitValue();
    }
  }

  // --- Line framing for the audit log
  // -------------------------------------------------------------
  // OUTPUT is framed on '\n' (a trailing '\r' is stripped); a bare '\r' stays in the line so a
  // progress bar's content is preserved rather than over-split. STDIN is framed on Enter
  // ('\r'/'\n').
  // The session assigns the sequence and timestamp at capture time so the async writer can't
  // reorder.

  private void frameOutput(String text) {
    if (logWriter == null) {
      return;
    }
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (ch == '\n') {
        String line = outLine.toString();
        if (line.endsWith("\r")) {
          line = line.substring(0, line.length() - 1);
        }
        emitLog(LogChannel.OUTPUT, line);
        outLine.setLength(0);
      } else {
        outLine.append(ch);
      }
    }
  }

  /** Called under {@link #stdinLock}. */
  private void frameInput(String text) {
    if (logWriter == null) {
      return;
    }
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      if (ch == '\r' || ch == '\n') {
        if (inLine.length() > 0) {
          emitLog(LogChannel.STDIN, inLine.toString());
          inLine.setLength(0);
        }
      } else {
        inLine.append(ch);
      }
    }
  }

  /** Flush any trailing partial lines when the process ends (no final newline). */
  private void flushPartialLines() {
    if (logWriter == null) {
      return;
    }
    if (outLine.length() > 0) {
      String line = outLine.toString();
      if (line.endsWith("\r")) {
        line = line.substring(0, line.length() - 1);
      }
      emitLog(LogChannel.OUTPUT, line);
      outLine.setLength(0);
    }
    synchronized (stdinLock) {
      if (inLine.length() > 0) {
        emitLog(LogChannel.STDIN, inLine.toString());
        inLine.setLength(0);
      }
    }
  }

  private void emitLog(LogChannel channel, String content) {
    String capped =
        content.length() > MAX_LOG_LINE_CHARS ? content.substring(0, MAX_LOG_LINE_CHARS) : content;
    logWriter.append(commandId, logSeq.getAndIncrement(), channel, capped, Instant.now());
  }

  private int safeExitValue() {
    try {
      return process.exitValue();
    } catch (IllegalThreadStateException stillRunning) {
      return -1;
    }
  }
}
