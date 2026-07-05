package eu.wohlben.qits.domain.repository.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.project.control.ProjectService;
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
 * Verifies the periodic checkpoint push against a real cloned-fixture repo (Fake runtime, so the
 * pushes are real host git): an ahead container's branch is pushed to origin, a level container is
 * left alone (no ref churn), and a checkpointed commit survives an unexpected container death — the
 * loss-window counterpart to {@link
 * WorkspaceContainerLifecycleServiceTest#unpushedWorkDiesWithAnUnexpectedlyRemovedContainer}.
 */
@QuarkusTest
@TestProfile(WorkspaceCheckpointServiceTest.TestProfile.class)
public class WorkspaceCheckpointServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-checkpoint-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;
  @Inject RepositoryService repositoryService;
  @Inject WorkspaceService workspaceService;
  @Inject WorkspaceCheckpointService checkpointService;
  @Inject ContainerRuntime containers;
  @Inject GitExecutor git;

  @ConfigProperty(name = "qits.repositories.data-dir")
  String dataDir;

  private String clonedRepo() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Checkpoint Project", null);
    return repositoryService.cloneRepository(fixtureUrl, null, project).id;
  }

  private String originHead(String repoId, String branch) throws Exception {
    Path originPath = Path.of(dataDir, repoId, "origin");
    return git.exec(originPath.toFile(), "git", "rev-parse", "refs/heads/" + branch).trim();
  }

  @Test
  public void checkpointPushesAnAheadContainerSoOriginAdvances() throws Exception {
    String repoId = clonedRepo();
    workspaceService.createWorkspace(repoId, "feat", "master", "feat", null);
    String container = containers.containerName("feat", repoId);
    String head = commitInContainer(container, "checkpoint.txt");

    var summary = checkpointService.checkpointAll();

    assertEquals(1, summary.pushed(), "the ahead container is checkpointed");
    assertEquals(head, originHead(repoId, "feat"), "origin advanced to the container HEAD");
  }

  @Test
  public void checkpointSkipsALevelContainer() throws Exception {
    String repoId = clonedRepo();
    workspaceService.createWorkspace(repoId, "feat", "master", "feat", null);
    String before = originHead(repoId, "feat");

    var summary = checkpointService.checkpointAll();

    // Containers from sibling tests linger (shared fake runtime), but they are all level too, so
    // the whole sweep must push nothing.
    assertEquals(0, summary.pushed(), "a container level with origin is not pushed");
    assertTrue(summary.skipped() >= 1, "the level container was visited and skipped");
    assertEquals(before, originHead(repoId, "feat"), "origin ref untouched");
  }

  @Test
  public void checkpointBoundsTheLossWindowOnUnexpectedContainerDeath() throws Exception {
    String repoId = clonedRepo();
    workspaceService.createWorkspace(repoId, "feat", "master", "feat", null);
    String container = containers.containerName("feat", repoId);
    String head = commitInContainer(container, "survivor.txt");

    // A checkpoint runs, then the container dies unexpectedly (no graceful stop, no push).
    checkpointService.checkpointAll();
    containers.rm(container);

    // Recreation restores origin state — which now includes the checkpointed commit.
    workspaceService.ensureContainer(repoId, "feat");
    assertEquals(
        head, containerHead(container), "the checkpointed commit survives the container's death");
  }

  /** Makes a commit in the container's /workspace without pushing it, returning the new HEAD. */
  private String commitInContainer(String container, String file) {
    containers.exec(
        container,
        "/workspace",
        Map.of(),
        "bash",
        "-lc",
        "echo hi > " + file + " && git add " + file + " && git commit -m local");
    return containerHead(container);
  }

  private String containerHead(String container) {
    return containers
        .exec(container, "/workspace", Map.of(), "git", "rev-parse", "HEAD")
        .output()
        .trim();
  }
}
