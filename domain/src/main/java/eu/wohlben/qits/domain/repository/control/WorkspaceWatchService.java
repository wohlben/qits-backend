package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.workspace.control.WorkspaceChangeHint;
import eu.wohlben.qits.domain.workspace.control.WorkspaceChangePublisher;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.event.ObservesAsync;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * The missing <em>push</em> behind the workspace's live working-tree freshness: one {@code
 * inotifywait} per active workspace, fanned out as {@link
 * eu.wohlben.qits.domain.workspace.control.WorkspaceChangeHint.Topic#FILES} hints so the browser
 * re-fetches {@code /files} and {@code /detection} when the coding agent scaffolds a module, a
 * {@code pom.xml}, or a test <em>without a commit</em> — the case a commit-SHA-keyed cache would go
 * stale on.
 *
 * <p>Its lifecycle follows the container's, mirroring {@code DaemonLifecycleCoupler}:
 *
 * <ul>
 *   <li><b>start</b> — on {@link WorkspaceContainerStarted} (a cold&#8594;RUNNING transition in
 *       {@code WorkspaceService.ensureContainer}), spawn the watcher. Observed
 *       {@code @ObservesAsync} so it never adds to {@code ensureContainer}'s latency. The
 *       already-RUNNING short-circuit does not fire the event, so no duplicate starts.
 *   <li><b>stop</b> — on {@link WorkspaceContainerStopping}, kill the watcher
 *       <em>synchronously</em> ({@code @Observes}) before the caller's {@code containers.rm}, while
 *       the container still exists.
 * </ul>
 *
 * <p>Raw inotify events are <b>coalesced and deduped centrally</b>: a burst opens one short window,
 * at whose end the working-tree marker ({@link WorkingTreeMarker}) is computed <em>once</em> and a
 * FILES hint fires only if it actually moved. So churn under a gitignored path (a build dir the
 * inotify {@code --exclude} missed) that changes neither {@code git status} nor {@code git diff}
 * yields no broadcast, and every listener is spared a no-op refetch — deduped here, once, not N
 * times downstream. One watcher per workspace, not per tab / SSE connection / query; the {@code
 * WorkspaceEventBroadcaster} fans each hint out to every connected browser. A watcher that dies
 * (e.g. inotify watch-limit exhaustion) is not auto-restarted here; the SSE reconnect resync and
 * the marker cache keep a re-fetch correct regardless.
 */
@ApplicationScoped
public class WorkspaceWatchService {

  private static final Logger LOG = Logger.getLogger(WorkspaceWatchService.class);

  @Inject ContainerRuntime containers;

  @Inject WorkspaceChangePublisher changePublisher;

  @Inject WorkingTreeMarker workingTreeMarker;

  /**
   * Kill switch for the whole watcher subsystem (mirrors the daemon autostart/autostop switches).
   */
  @ConfigProperty(name = "qits.workspace.watch.enabled", defaultValue = "true")
  boolean enabled;

  /** How long a burst of raw events is collapsed before one marker check + at-most-one hint. */
  @ConfigProperty(name = "qits.workspace.watch.coalesce-ms", defaultValue = "250")
  long coalesceMillis;

  private final Map<String, WorkspaceWatchSession> sessions = new ConcurrentHashMap<>();
  private final Map<String, String> lastMarker = new ConcurrentHashMap<>();
  private final Set<String> openWindows = ConcurrentHashMap.newKeySet();

  private final ScheduledExecutorService scheduler =
      Executors.newSingleThreadScheduledExecutor(
          runnable -> {
            Thread thread = new Thread(runnable, "workspace-watch-coalesce");
            thread.setDaemon(true);
            return thread;
          });

  void onContainerStarted(@ObservesAsync WorkspaceContainerStarted evt) {
    if (!enabled) {
      return;
    }
    start(evt.repoId(), evt.workspaceId());
  }

  void onContainerStopping(@Observes WorkspaceContainerStopping evt) {
    stop(evt.repoId(), evt.workspaceId());
  }

  @PreDestroy
  void shutdown() {
    sessions.values().forEach(WorkspaceWatchSession::close);
    sessions.clear();
    scheduler.shutdownNow();
  }

  private void start(String repoId, String workspaceId) {
    String key = key(repoId, workspaceId);
    sessions.compute(
        key,
        (k, existing) -> {
          if (existing != null) {
            // A re-provision after teardown: drop the stale session (its container is gone) first.
            existing.close();
          }
          // A fresh container starts with a clean slate — force the first real change to broadcast.
          lastMarker.remove(key);
          String container = containers.containerName(workspaceId, repoId);
          try {
            return new WorkspaceWatchSession(
                repoId, workspaceId, watchArgv(container), () -> onRawChange(repoId, workspaceId));
          } catch (RuntimeException e) {
            LOG.warnf(e, "Failed to start file watcher for %s", key);
            return null;
          }
        });
  }

  private void stop(String repoId, String workspaceId) {
    String key = key(repoId, workspaceId);
    WorkspaceWatchSession session = sessions.remove(key);
    if (session != null) {
      session.close();
    }
    lastMarker.remove(key);
  }

  /** A raw inotify line arrived: open a coalescing window if one isn't already pending. */
  private void onRawChange(String repoId, String workspaceId) {
    String key = key(repoId, workspaceId);
    if (openWindows.add(key)) {
      scheduler.schedule(
          () -> settleWindow(repoId, workspaceId), coalesceMillis, TimeUnit.MILLISECONDS);
    }
  }

  /**
   * The coalescing window closed: compute the marker once and fire a FILES hint only if it moved.
   * The window is cleared <em>before</em> the (git-touching) marker computation, so an event
   * arriving mid-computation opens a fresh window rather than being swallowed.
   */
  private void settleWindow(String repoId, String workspaceId) {
    String key = key(repoId, workspaceId);
    openWindows.remove(key);
    if (!sessions.containsKey(key)) {
      return; // stopped since the window opened — the container may already be gone
    }
    String marker;
    try {
      marker = workingTreeMarker.compute(repoId, workspaceId);
    } catch (RuntimeException e) {
      LOG.debugf(e, "Skipping file-change hint for %s (marker unavailable)", key);
      return;
    }
    if (markerChanged(key, marker)) {
      changePublisher.fire(repoId, workspaceId, WorkspaceChangeHint.Topic.FILES);
    }
  }

  /**
   * Records {@code marker} as the workspace's latest; true iff it differs from the last recorded.
   */
  boolean markerChanged(String key, String marker) {
    return !marker.equals(lastMarker.put(key, marker));
  }

  /**
   * The {@code inotifywait} command watched over {@code /workspace}: monitor continuously ({@code
   * -m}), recursively ({@code -r}), on the mutating events, excluding the heavy build/VCS dirs
   * whose churn never changes what {@code /files} or {@code /detection} report. Each stdout line
   * opens a coalescing window; the marker check at its end is the authoritative "did anything
   * change."
   *
   * <p>Package-private so {@code WorkspaceWatchIT} exercises the exact production argv.
   */
  List<String> watchArgv(String container) {
    List<String> argv =
        new ArrayList<>(containers.execArgv(container, false, "/workspace", Map.of()));
    argv.add("inotifywait");
    argv.add("-m"); // monitor continuously (do not exit after the first event)
    argv.add("-r"); // recurse into subdirectories
    argv.add("-q"); // quiet: drop the "Setting up watches" banner (stderr is discarded anyway)
    argv.add("-e");
    argv.add("modify");
    argv.add("-e");
    argv.add("create");
    argv.add("-e");
    argv.add("delete");
    argv.add("-e");
    argv.add("move");
    argv.add("-e");
    argv.add("close_write");
    argv.add("--exclude");
    argv.add("(^|/)(\\.git|node_modules|target|dist|build|\\.angular|\\.gradle)(/|$)");
    argv.add("/workspace");
    return argv;
  }

  /** Test seam: how many workspaces currently have a live watcher session. */
  int activeWatchCount() {
    return sessions.size();
  }

  private static String key(String repoId, String workspaceId) {
    return repoId + "/" + workspaceId;
  }
}
