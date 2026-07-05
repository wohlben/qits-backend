package eu.wohlben.qits.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.dto.WorkspaceDto;
import io.quarkus.test.TestTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(SeedServiceTest.TestProfile.class)
public class SeedServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-seed-test");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject SeedService seedService;
  @Inject ProjectService projectService;
  @Inject WorkspaceService workspaceService;

  @Test
  @TestTransaction
  public void seedsFastForwardableAndDivergedWorkspaces() {
    // Drives the command via the real services with no JAX-RS request context — a guard for
    // the command-mode wiring (@ActivateRequestContext on seed()).
    assertTrue(seedService.seed(), "first seed should create data");
    assertFalse(seedService.seed(), "second seed should be a no-op (idempotent)");

    Project project =
        projectService.list().stream()
            .filter(p -> "Demo Project".equals(p.name))
            .findFirst()
            .orElse(null);
    assertNotNull(project, "Demo Project should exist");

    String repoId = projectService.getRepositories(project.id).get(0).id;
    Map<String, WorkspaceDto> byId = new java.util.HashMap<>();
    for (WorkspaceDto wt : workspaceService.listWorkspaces(repoId)) {
      byId.put(wt.workspaceId(), wt);
    }

    // behind-ff: strictly behind its parent, nothing of its own -> fast-forwardable.
    WorkspaceDto behindFf = byId.get("behind-ff");
    assertNotNull(behindFf);
    assertEquals(0, behindFf.ahead());
    assertTrue(behindFf.behind() > 0, "behind-ff should be behind its parent");

    // diverged: both ahead of and behind its parent -> warning, not fast-forwardable.
    WorkspaceDto diverged = byId.get("diverged");
    assertNotNull(diverged);
    assertTrue(diverged.ahead() > 0, "diverged should be ahead of its parent");
    assertTrue(diverged.behind() > 0, "diverged should be behind its parent");
  }
}
