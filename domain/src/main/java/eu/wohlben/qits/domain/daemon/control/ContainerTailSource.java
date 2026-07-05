package eu.wohlben.qits.domain.daemon.control;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.ProcessBuilder.Redirect;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import org.jboss.logging.Logger;

/**
 * Tails one FILE log source of a daemon instance <em>inside its container</em> and feeds its
 * observers. Since a workspace's working tree lives in the container ({@code /workspace}), not on
 * the host, the tail runs as {@code <runtime> exec … tail -F <path>} (built by {@link
 * eu.wohlben.qits.domain.repository.control.ContainerRuntime#execArgv}) and this class streams the
 * process's stdout, framing it line-by-line for the same {@link ObservedLineListener}s the host
 * tail used to feed.
 *
 * <p>{@code tail -F} owns the follow semantics (start at end via {@code -n 0}; retry a missing file
 * and reopen on rotation/recreation), so a late-appearing file is read from its first line. Lines
 * carry a monotonically increasing 1-based position under a single epoch fixed at start; ANSI is
 * stripped and blank lines consume a position but are not dispatched — matching the previous host
 * {@code FileTailSource} so observers and anchors are unchanged.
 */
final class ContainerTailSource {

  private static final Logger LOG = Logger.getLogger(ContainerTailSource.class);

  private final String source;
  private final List<ObservedLineListener> listeners;
  private final Process process;
  private final Thread reader;
  private volatile boolean closed;

  ContainerTailSource(List<String> argv, String source, List<ObservedLineListener> listeners) {
    this.source = source;
    this.listeners = List.copyOf(listeners);
    Process started;
    try {
      // stdout is the line stream; stderr (tail's "following new file" notices) is discarded so it
      // can never fill its pipe and block the process.
      started =
          new ProcessBuilder(argv)
              .redirectError(Redirect.DISCARD)
              .redirectInput(Redirect.PIPE)
              .start();
    } catch (IOException e) {
      throw new IllegalStateException("Failed to start container tail for " + source, e);
    }
    this.process = started;
    Instant epoch = Instant.now();
    this.reader = new Thread(() -> readLoop(epoch), "daemon-tail-" + source);
    this.reader.setDaemon(true);
    this.reader.start();
  }

  private void readLoop(Instant epoch) {
    long lineNumber = 0;
    try (BufferedReader in =
        new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String raw;
      while (!closed && (raw = in.readLine()) != null) {
        long position = ++lineNumber; // blank lines still consume a position (true line numbers)
        String line = LineFramingSink.stripAnsi(raw);
        if (line.isBlank()) {
          continue;
        }
        ObservedLine observed = new ObservedLine(source, position, epoch, line);
        for (ObservedLineListener listener : listeners) {
          try {
            listener.onLine(observed);
          } catch (RuntimeException e) {
            LOG.warnf(e, "Observer failed on a tailed line from %s", source);
          }
        }
      }
    } catch (IOException e) {
      if (!closed) {
        LOG.debugf(e, "Container tail read failed for %s", source);
      }
    }
  }

  /** Stops the tail: kill the {@code tail} process and let the reader thread drain and exit. */
  void close() {
    closed = true;
    process.destroy();
    reader.interrupt();
  }
}
