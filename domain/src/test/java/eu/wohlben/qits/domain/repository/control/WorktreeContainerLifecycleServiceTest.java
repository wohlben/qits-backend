package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.WorktreeRuntimeStatus;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/**
 * Verifies the disposable-container lifecycle against a real cloned-fixture repo (Fake runtime): a
 * lost container is re-provisioned from the durable branch, its runtime status is surfaced, and a
 * worktree is abandoned only when the branch itself is gone.
 */
@QuarkusTest
@TestProfile(WorktreeContainerLifecycleServiceTest.TestProfile.class)
public class WorktreeContainerLifecycleServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-lifecycle-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;
  @Inject RepositoryService repositoryService;
  @Inject WorktreeService worktreeService;
  @Inject RepositoryDiscoveryService discoveryService;
  @Inject ContainerRuntime containers;
  @Inject GitExecutor git;

  @ConfigProperty(name = "qits.repositories.data-dir")
  String dataDir;

  private String clonedRepo() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Lifecycle Project", null);
    return repositoryService.cloneRepository(fixtureUrl, null, project).id;
  }

  private WorktreeDto worktreeDto(String repoId, String worktreeId) {
    return worktreeService.listWorktrees(repoId).stream()
        .filter(w -> worktreeId.equals(w.worktreeId()))
        .findFirst()
        .orElseThrow();
  }

  @Test
  public void ensureContainerRecreatesALostContainerFromTheBranch() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    String container = containers.containerName("feat", repoId);
    assertTrue(containers.exists(container));
    assertEquals(WorktreeRuntimeStatus.RUNNING, worktreeDto(repoId, "feat").runtimeStatus());

    // Container vanishes out-of-band; the branch — the real work — is untouched in origin.
    containers.rm(container);
    assertFalse(containers.exists(container));
    assertEquals(WorktreeRuntimeStatus.STOPPED, worktreeDto(repoId, "feat").runtimeStatus());

    // ensureContainer re-provisions from the durable branch and the worktree stays ACTIVE.
    worktreeService.ensureContainer(repoId, "feat");
    assertTrue(containers.exists(container), "container is re-provisioned");
    WorktreeDto dto = worktreeDto(repoId, "feat");
    assertEquals(WorktreeStatus.ACTIVE, dto.status());
    assertEquals(WorktreeRuntimeStatus.RUNNING, dto.runtimeStatus());
  }

  @Test
  public void ensureContainerIsANoOpWhenAlreadyRunning() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);

    // Should not throw and should leave the (same) container running.
    worktreeService.ensureContainer(repoId, "feat");
    assertTrue(containers.exists(containers.containerName("feat", repoId)));
    assertEquals(WorktreeRuntimeStatus.RUNNING, worktreeDto(repoId, "feat").runtimeStatus());
  }

  @Test
  public void ensureContainerAbandonsWhenTheBranchIsGone() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    String container = containers.containerName("feat", repoId);

    // Both the container AND the durable branch disappear: the work no longer exists anywhere.
    containers.rm(container);
    Path originPath = Path.of(dataDir, repoId, "origin");
    git.exec(originPath.toFile(), "git", "branch", "-D", "--", "feat");

    assertThrows(NotFoundException.class, () -> worktreeService.ensureContainer(repoId, "feat"));

    // The worktree is abandoned (the only path to abandonment) and drops off the active list.
    assertFalse(
        worktreeService.listWorktrees(repoId).stream().anyMatch(w -> "feat".equals(w.worktreeId())),
        "a worktree with no branch to recreate from is abandoned");
  }

  @Test
  public void reconcileMarksAContainerlessButLiveBranchStoppedNotAbandoned() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    containers.rm(containers.containerName("feat", repoId));

    // Reconciliation keys off the branch, not the container: the branch survives, so the worktree
    // stays ACTIVE (STOPPED runtime), not ABANDONED.
    discoveryService.discover();

    WorktreeDto dto = worktreeDto(repoId, "feat");
    assertEquals(WorktreeStatus.ACTIVE, dto.status());
    assertEquals(WorktreeRuntimeStatus.STOPPED, dto.runtimeStatus());
  }

  @Test
  public void stopContainerRemovesTheContainerButKeepsTheWorktreeActive() throws Exception {
    String repoId = clonedRepo();
    worktreeService.createWorktree(repoId, "feat", "master", "feat", null);
    String container = containers.containerName("feat", repoId);

    worktreeService.stopContainer(repoId, "feat");

    assertFalse(containers.exists(container), "graceful stop removes the container");
    WorktreeDto dto = worktreeDto(repoId, "feat");
    assertEquals(WorktreeStatus.ACTIVE, dto.status(), "the worktree stays active");
    assertEquals(WorktreeRuntimeStatus.STOPPED, dto.runtimeStatus());

    // ...and it can be brought straight back.
    worktreeService.ensureContainer(repoId, "feat");
    assertTrue(containers.exists(container));
  }
}
