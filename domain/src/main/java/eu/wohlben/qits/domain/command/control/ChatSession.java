package eu.wohlben.qits.domain.command.control;

import com.fasterxml.jackson.databind.ObjectMapper;
import eu.wohlben.qits.domain.command.entity.LogChannel;
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
 * sends. That single stream is ringed (for re-attach), broadcast (live), and persisted on {@link
 * LogChannel#OUTPUT} (for replay of a finished session) — so live and replay render identically.
 */
final class ChatSession {

  private static final Logger LOG = Logger.getLogger(ChatSession.class);

  /** How much recent conversation (in bytes of JSONL) to retain for replay on re-attach. */
  private static final int RING_CAPACITY_BYTES = 256 * 1024;

  private static final int MAX_LOG_LINE_CHARS = 64 * 1024;

  private final ObjectMapper mapper = new ObjectMapper();
  private final String commandId;
  private final Process process;
  private final BufferedWriter stdin;
  private final CommandExitListener exitListener;
  private final Runnable onComplete;
  private final CommandLogWriter logWriter;

  private final AtomicLong logSeq = new AtomicLong();
  private final Deque<String> ring = new ArrayDeque<>();
  private int ringBytes;
  private final Deque<CommandOutputSink> sinks = new ArrayDeque<>();
  private final Object stdinLock = new Object();

  private volatile boolean terminatedManually;
  private final CountDownLatch finished = new CountDownLatch(1);
  private volatile int exitCode = -1;

  ChatSession(
      String commandId,
      Process process,
      CommandExitListener exitListener,
      Runnable onComplete,
      CommandLogWriter logWriter) {
    this.commandId = commandId;
    this.process = process;
    this.exitListener = exitListener;
    this.onComplete = onComplete;
    this.logWriter = logWriter;
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

  /** Ring + broadcast + persist a single JSON line of the unified conversation stream. */
  private void emitLine(String line) {
    synchronized (this) {
      appendToRing(line);
      broadcast(line + "\n");
    }
    if (logWriter != null) {
      String capped =
          line.length() > MAX_LOG_LINE_CHARS ? line.substring(0, MAX_LOG_LINE_CHARS) : line;
      logWriter.append(
          commandId, logSeq.getAndIncrement(), LogChannel.OUTPUT, capped, Instant.now());
    }
  }

  synchronized void attach(CommandOutputSink sink) {
    if (!ring.isEmpty()) {
      StringBuilder replay = new StringBuilder();
      for (String line : ring) {
        replay.append(line).append('\n');
      }
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
    process.destroy();
    awaitExit(TimeUnit.SECONDS.toMillis(2));
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

  private void appendToRing(String line) {
    ring.add(line);
    ringBytes += line.length();
    while (ringBytes > RING_CAPACITY_BYTES && ring.size() > 1) {
      ringBytes -= ring.removeFirst().length();
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
