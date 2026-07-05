package eu.wohlben.qits.domain.repository.control;

import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Periodically pushes every running workspace container's branch to its bare origin, so an
 * unexpected container death (host reboot, {@code docker rm}, a crash) loses at most one interval
 * of committed work. The graceful path already pushes ({@link WorkspaceService#stopContainer});
 * this bounds the ungraceful one. Best-effort throughout: a failed checkpoint must never disrupt a
 * container or the user.
 *
 * <p>The sweep is deliberately DB-free (repos come from the data-dir layout, branches from the
 * containers' create-time labels), so it needs no request context or transaction on the scheduler
 * thread — keep it that way; entity access from here would need the separate-persister-bean pattern
 * (see {@code CommandLogBatchPersister}).
 */
@ApplicationScoped
public class WorkspaceCheckpointService {

  private static final Logger LOG = Logger.getLogger(WorkspaceCheckpointService.class);

  @Inject ContainerRuntime containers;

  @Inject WorkspaceService workspaceService;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  /** How often the checkpoint sweep runs; 0 disables it (the cli and tests leave it off). */
  @ConfigProperty(name = "qits.workspace.checkpoint-interval-ms", defaultValue = "0")
  long checkpointIntervalMillis;

  private final ScheduledExecutorService scheduler =
      Executors.newSingleThreadScheduledExecutor(
          runnable -> {
            Thread thread = new Thread(runnable, "workspace-checkpoint");
            thread.setDaemon(true);
            return thread;
          });

  void onStart(@Observes StartupEvent event) {
    if (checkpointIntervalMillis <= 0) {
      return;
    }
    scheduler.scheduleWithFixedDelay(
        this::safeSweep, checkpointIntervalMillis, checkpointIntervalMillis, TimeUnit.MILLISECONDS);
  }

  @PreDestroy
  void shutdown() {
    scheduler.shutdownNow();
  }

  /** An uncaught exception would silently cancel the fixed-delay schedule — never let one out. */
  private void safeSweep() {
    try {
      checkpointAll();
    } catch (Throwable t) {
      LOG.warn("Checkpoint sweep failed", t);
    }
  }

  /** What one sweep did: containers pushed vs. skipped because already level with origin. */
  public record CheckpointSummary(int pushed, int skipped) {}

  /**
   * One synchronous sweep over every repository's running containers: pushes each container whose
   * HEAD is ahead of the origin ref, skips the ones already level (no ref churn for idle
   * workspaces). One container's failure never aborts the rest of the sweep.
   */
  public CheckpointSummary checkpointAll() {
    int pushed = 0;
    int skipped = 0;
    for (String repoId : repoIdsOnDisk()) {
      Path originPath = Path.of(dataDir, repoId, "origin");
      for (ContainerRuntime.ContainerInfo info : containers.listWorkspaceContainers(repoId)) {
        try {
          if (workspaceService.isFullyPushed(
              repoId, originPath, info.workspaceId(), info.branch())) {
            skipped++;
            continue;
          }
          workspaceService.pushBranch(repoId, info.workspaceId(), info.branch());
          pushed++;
        } catch (RuntimeException e) {
          LOG.warnf(e, "Checkpoint push failed for %s/%s", repoId, info.workspaceId());
        }
      }
    }
    if (pushed > 0) {
      LOG.debugf("Checkpoint sweep pushed %d container(s), skipped %d", pushed, skipped);
    }
    return new CheckpointSummary(pushed, skipped);
  }

  /**
   * A repo is a data-dir subdir containing an origin/ — the same rule repository discovery uses.
   */
  private List<String> repoIdsOnDisk() {
    Path dataPath = Path.of(dataDir);
    if (!Files.exists(dataPath)) {
      return List.of();
    }
    try (var stream = Files.list(dataPath)) {
      return stream
          .filter(Files::isDirectory)
          .filter(dir -> Files.exists(dir.resolve("origin")))
          .map(dir -> dir.getFileName().toString())
          .toList();
    } catch (IOException e) {
      LOG.warn("Checkpoint sweep could not list repositories", e);
      return List.of();
    }
  }
}
