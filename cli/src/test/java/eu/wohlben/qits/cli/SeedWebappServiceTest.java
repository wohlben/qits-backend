package eu.wohlben.qits.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(SeedWebappServiceTest.TestProfile.class)
public class SeedWebappServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-seed-webapp-test");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject SeedWebappService seedWebappService;
  @Inject ProjectService projectService;
  @Inject WorktreeService worktreeService;
  @Inject RepositoryDaemonService repositoryDaemonService;

  // No @TestTransaction: the reset does delete-then-recreate, which must span separate committed
  // transactions exactly as command mode does (each @Transactional service call commits on its
  // own).
  // Wrapping it in one test transaction would flush both in a single Hibernate session and trip a
  // transient-reference error that never occurs in the real CLI. This profile boots its own Quarkus
  // instance with a clean in-memory H2, so leaving committed rows behind is harmless.
  @Test
  public void seedsWebViewableDaemonAndDivergedWorktrees() {
    // Drives the command via the real services with no JAX-RS request context — a guard for the
    // command-mode wiring (@ActivateRequestContext on seed()).
    Repository first = seedWebappService.seed();
    assertNotNull(first, "first seed should create the repository");

    // Idempotent by reset: a second run tears the prior project down and recreates it, so there is
    // still exactly one project and its worktrees are back to the known-good state (not duplicated,
    // not "already exists" errors from re-creating the same worktree ids).
    Repository second = seedWebappService.seed();
    assertNotNull(second);
    assertEquals(
        1,
        projectService.list().stream()
            .filter(p -> SeedWebappService.PROJECT_NAME.equals(p.name))
            .count(),
        "reset should leave exactly one project");

    Project project =
        projectService.list().stream()
            .filter(p -> SeedWebappService.PROJECT_NAME.equals(p.name))
            .findFirst()
            .orElse(null);
    assertNotNull(project, "demo project should exist");

    Repository repo = projectService.getRepositories(project.id).get(0);
    assertEquals("main", repo.mainBranch, "fixture's default branch is 'main'");

    // The dev-server daemon is defined and web-viewable (httpPort set lights up the web-view
    // button).
    List<RepositoryDaemon> daemons = repositoryDaemonService.list(repo.id);
    RepositoryDaemon devServer =
        daemons.stream().filter(d -> "Quarkus dev server".equals(d.name)).findFirst().orElse(null);
    assertNotNull(devServer, "Quarkus dev server daemon should be defined");
    assertEquals(8080, devServer.httpPort, "dev server daemon should be web-viewable on 8080");

    Map<String, WorktreeDto> byId = new java.util.HashMap<>();
    for (WorktreeDto wt : worktreeService.listWorktrees(repo.id)) {
      byId.put(wt.worktreeId(), wt);
    }

    // behind-ff: strictly behind its parent, nothing of its own -> fast-forwardable.
    WorktreeDto behindFf = byId.get("behind-ff");
    assertNotNull(behindFf);
    assertEquals(0, behindFf.ahead());
    assertTrue(behindFf.behind() > 0, "behind-ff should be behind its parent");
  }
}
