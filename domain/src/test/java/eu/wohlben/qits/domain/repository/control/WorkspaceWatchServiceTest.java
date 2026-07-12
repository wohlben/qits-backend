package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * The per-workspace file watcher's contracts: each stdout line of the watch process fires the
 * change callback once; the marker dedup fires only when the working-tree marker actually moves;
 * and the watcher's lifecycle follows the container's — a {@code WorkspaceContainerStarted} starts
 * a session, a {@code WorkspaceContainerStopping} stops it. Enabled here via a {@code @TestProfile}
 * (off by default in tests); the kill-switch case is {@link WorkspaceWatchKillSwitchTest}.
 */
@QuarkusTest
@TestProfile(WorkspaceWatchServiceTest.TestProfile.class)
public class WorkspaceWatchServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-workspace-watch-test-repos");
        return Map.of(
            "qits.repositories.data-dir",
            tempDir.toString(),
            "qits.workspace.watch.enabled",
            "true");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private static final long AWAIT_MILLIS = 5_000;

  @Inject ProjectService projectService;
  @Inject RepositoryService repositoryService;
  @Inject WorkspaceService workspaceService;
  @Inject WorkspaceWatchService watchService;
  @Inject WorkspaceContainerEventPublisher containerEvents;

  @Test
  public void invokesTheChangeCallbackPerWatchLine() throws Exception {
    AtomicInteger changes = new AtomicInteger();
    // A benign process that emits two lines then exits — stands in for inotifywait's change stream,
    // so the reader→callback contract is verified with no inotifywait/docker dependency.
    WorkspaceWatchSession session =
        new WorkspaceWatchSession(
            "repo-1", "wt-1", List.of("sh", "-c", "printf 'a\\nb\\n'"), changes::incrementAndGet);
    try {
      awaitCondition(() -> changes.get() == 2, "two change callbacks");
    } finally {
      session.close();
    }
    assertEquals(2, changes.get());
  }

  @Test
  public void markerDedupFiresOnlyWhenTheMarkerMoves() {
    // First sight of a marker fires; a repeat is suppressed; a new marker fires again.
    assertTrue(watchService.markerChanged("k", "m1"), "first marker always fires");
    assertFalse(watchService.markerChanged("k", "m1"), "an unchanged marker is deduped");
    assertTrue(watchService.markerChanged("k", "m2"), "a moved marker fires again");
    assertFalse(watchService.markerChanged("k", "m2"), "and is then deduped");
  }

  @Test
  public void startsWatcherOnContainerStartedAndStopsOnStopping() throws Exception {
    String repoId = repoWithWorkspace();
    assertEquals(0, watchService.activeWatchCount(), "no watcher before the container starts");

    // Fired async (as ensureContainer does); the observer starts a session off the event thread.
    containerEvents.fireStarted(repoId, "work");
    awaitCondition(() -> watchService.activeWatchCount() == 1, "one active watcher");

    // Fired synchronously before containers.rm; the session is torn down inline.
    containerEvents.fireStopping(repoId, "work", true);
    assertEquals(0, watchService.activeWatchCount(), "the watcher stops with the container");
  }

  /** Clones the fixture and adds a lazy {@code work} workspace (no container yet). */
  private String repoWithWorkspace() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Watch Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    workspaceService.createWorkspace(repo.id, "work", "master", "work");
    return repo.id;
  }

  private void awaitCondition(java.util.function.BooleanSupplier condition, String what)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    while (System.currentTimeMillis() < deadline) {
      if (condition.getAsBoolean()) {
        return;
      }
      Thread.sleep(25);
    }
    throw new AssertionError("Timed out waiting for " + what);
  }
}
