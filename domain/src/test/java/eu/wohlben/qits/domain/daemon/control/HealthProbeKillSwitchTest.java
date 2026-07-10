package eu.wohlben.qits.domain.daemon.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import eu.wohlben.qits.domain.daemon.dto.DaemonInstanceDto;
import eu.wohlben.qits.domain.daemon.dto.HealthCheckState;
import eu.wohlben.qits.domain.daemon.entity.DaemonStatus;
import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.HealthCheckKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The {@code qits.daemons.health-enabled=false} kill switch: declared checks stay visible but are
 * never probed — all-UNKNOWN with no runtime data, and the daemon lifecycle runs unaffected.
 */
@QuarkusTest
@TestProfile(HealthProbeKillSwitchTest.TestProfile.class)
public class HealthProbeKillSwitchTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-health-killswitch-repos");
        return Map.of(
            "qits.repositories.data-dir", tempDir.toString(),
            "qits.daemons.ready-grace-ms", "300",
            "qits.daemons.stop-grace-ms", "1000",
            "qits.daemons.liveness-poll-ms", "150",
            "qits.daemons.health-poll-ms", "100",
            "qits.daemons.health-enabled", "false");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorkspaceService workspaceService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject DaemonSupervisor supervisor;

  @Test
  public void disabledHealthLeavesChecksUnprobed() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Health Killswitch Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    workspaceService.createWorkspace(repo.id, "work", "master", "work");
    workspaceService.ensureContainer(repo.id, "work");
    String daemonId =
        repositoryDaemonService.create(
                repo.id,
                "unprobed",
                null,
                "while true; do echo tick; sleep 0.2; done",
                "tick",
                "TERM",
                RestartPolicy.NEVER,
                null,
                0,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                List.of(
                    new HealthCheck(
                        "always",
                        HealthCheckKind.COMMAND,
                        null,
                        null,
                        null,
                        "true",
                        null,
                        null,
                        null,
                        1,
                        0L)))
            .id;

    supervisor.start(repo.id, "work", daemonId);
    try {
      awaitStatus(repo.id, daemonId, DaemonStatus.READY);
      // Several would-be probe intervals later the check still has no verdict and no runtime data.
      Thread.sleep(500);
      DaemonInstanceDto instance = instanceOf(repo.id, daemonId);
      assertEquals(1, instance.health().size(), "declared checks stay visible");
      assertEquals(HealthCheckState.UNKNOWN, instance.health().get(0).state());
      assertNull(instance.health().get(0).lastCheckedAt(), "never probed");
    } finally {
      supervisor.stop(repo.id, "work", daemonId);
      awaitStatus(repo.id, daemonId, DaemonStatus.STOPPED);
    }
  }

  private DaemonInstanceDto instanceOf(String repoId, String daemonId) {
    return supervisor.effectiveDaemons(repoId, "work").stream()
        .filter(i -> i.daemon().id().equals(daemonId))
        .findFirst()
        .orElse(null);
  }

  private DaemonInstanceDto awaitStatus(String repoId, String daemonId, DaemonStatus expected)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + 15_000;
    DaemonInstanceDto last = null;
    while (System.currentTimeMillis() < deadline) {
      last = instanceOf(repoId, daemonId);
      if (last != null && last.status() == expected) {
        return last;
      }
      Thread.sleep(50);
    }
    throw new AssertionError("Timed out waiting for " + expected + "; last state: " + last);
  }
}
