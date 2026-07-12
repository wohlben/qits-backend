package eu.wohlben.qits.domain.repository.control;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.ProcessBuilder.Redirect;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.jboss.logging.Logger;

/**
 * Watches one workspace's working tree <em>inside its container</em> and calls {@code onChange}
 * once per raw change. Since a workspace's tree lives in the container ({@code /workspace}), not on
 * the host, the watch runs as {@code <runtime> exec … inotifywait -m …} (argv built by {@link
 * ContainerRuntime#execArgv}) and this class streams the process's stdout, invoking the callback
 * per non-blank line. Structurally the sibling of {@code
 * eu.wohlben.qits.domain.daemon.control.ContainerTailSource} (a long-running {@code docker exec}
 * whose stdout is read on a daemon thread), differing only in what it does with each line.
 *
 * <p>It does no coalescing or dedup itself — that is {@link WorkspaceWatchService}'s job (it
 * collapses a burst into one working-tree-marker check). A dropped or missed event self-heals: the
 * frontend re-fetches on the next tick or on SSE reconnect, validated against the server-side
 * marker cache.
 */
final class WorkspaceWatchSession {

  private static final Logger LOG = Logger.getLogger(WorkspaceWatchSession.class);

  private final String workspaceId;
  private final Runnable onChange;
  private final Process process;
  private final Thread reader;
  private volatile boolean closed;

  WorkspaceWatchSession(String repoId, String workspaceId, List<String> argv, Runnable onChange) {
    this.workspaceId = workspaceId;
    this.onChange = onChange;
    Process started;
    try {
      // stdout is the change stream; stderr (inotifywait's "Setting up watches" banner and any
      // per-event errors) is discarded so it can never fill its pipe and block the process.
      started =
          new ProcessBuilder(argv)
              .redirectError(Redirect.DISCARD)
              .redirectInput(Redirect.PIPE)
              .start();
    } catch (IOException e) {
      throw new IllegalStateException(
          "Failed to start file watcher for " + repoId + "/" + workspaceId, e);
    }
    this.process = started;
    this.reader = new Thread(this::readLoop, "workspace-watch-" + workspaceId);
    this.reader.setDaemon(true);
    this.reader.start();
  }

  private void readLoop() {
    try (BufferedReader in =
        new BufferedReader(
            new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
      String raw;
      while (!closed && (raw = in.readLine()) != null) {
        if (raw.isBlank()) {
          continue;
        }
        try {
          onChange.run();
        } catch (RuntimeException e) {
          LOG.debugf(e, "File watcher onChange failed for %s", workspaceId);
        }
      }
    } catch (IOException e) {
      if (!closed) {
        LOG.debugf(e, "File watcher read failed for %s", workspaceId);
      }
    }
  }

  /** Stops the watch: kill the {@code inotifywait} process and let the reader thread exit. */
  void close() {
    closed = true;
    process.destroy();
    reader.interrupt();
  }
}
