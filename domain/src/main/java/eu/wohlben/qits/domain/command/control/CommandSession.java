package eu.wohlben.qits.domain.command.control;

import com.pty4j.PtyProcess;
import com.pty4j.WinSize;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
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

  private final String commandId;
  private final PtyProcess process;
  private final CommandExitListener exitListener;
  private final Runnable onComplete;

  /** Recent raw output chunks, total bounded by {@link #RING_CAPACITY_BYTES}, for replay. */
  private final Deque<byte[]> ring = new ArrayDeque<>();

  private int ringBytes;

  /** Attached output destinations; mutated and iterated only under the session monitor. */
  private final Deque<CommandOutputSink> sinks = new ArrayDeque<>();

  /** Serializes stdin writes from concurrent clients so their bytes don't interleave. */
  private final Object stdinLock = new Object();

  private volatile boolean terminatedManually;
  private Thread reader;

  CommandSession(
      String commandId, PtyProcess process, CommandExitListener exitListener, Runnable onComplete) {
    this.commandId = commandId;
    this.process = process;
    this.exitListener = exitListener;
    this.onComplete = onComplete;
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
   * Force-kill the process. A login {@code bash -l} ignores the SIGHUP that {@code destroy()}
   * sends, so a SIGKILL is needed; closing the streams unblocks the reader's native {@code read()}.
   */
  void terminate() {
    terminatedManually = true;
    process.destroyForcibly();
    try {
      process.getInputStream().close();
      process.getOutputStream().close();
    } catch (IOException ignored) {
      // Best-effort: the process is already being killed.
    }
    awaitExit(TimeUnit.SECONDS.toMillis(2));
  }

  boolean isAlive() {
    return process.isAlive();
  }

  /** Block until the process exits (or the timeout elapses); returns its exit code, or -1. */
  int awaitExit(long timeoutMillis) {
    try {
      if (process.waitFor(timeoutMillis, TimeUnit.MILLISECONDS)) {
        if (reader != null) {
          reader.join(TimeUnit.SECONDS.toMillis(2));
        }
        return safeExitValue();
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
    int exitCode = safeExitValue();
    try {
      exitListener.onExit(commandId, exitCode, terminatedManually);
    } catch (RuntimeException e) {
      LOG.errorf(e, "Exit listener failed for command %s", commandId);
    } finally {
      onComplete.run();
    }
  }

  private int safeExitValue() {
    try {
      return process.exitValue();
    } catch (IllegalThreadStateException stillRunning) {
      return -1;
    }
  }
}
