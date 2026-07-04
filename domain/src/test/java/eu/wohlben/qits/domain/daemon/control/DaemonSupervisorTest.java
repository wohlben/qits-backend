package eu.wohlben.qits.domain.daemon.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.daemon.dto.DaemonEventDto;
import eu.wohlben.qits.domain.daemon.dto.DaemonInstanceDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventKind;
import eu.wohlben.qits.domain.daemon.entity.DaemonStatus;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
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
 * Drives the supervisor state machine against real processes in a cloned-fixture worktree:
 * readiness via pattern and grace, the restart policies (with new Command rows per relaunch),
 * graceful stop, and the singleton-per-(worktree, daemon) rule.
 */
@QuarkusTest
@TestProfile(DaemonSupervisorTest.TestProfile.class)
public class DaemonSupervisorTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-daemon-test-repos");
        return Map.of(
            "qits.repositories.data-dir", tempDir.toString(),
            // Test-speed supervisor timing: fast grace-READY, fast restart backoff.
            "qits.daemons.ready-grace-ms", "300",
            "qits.daemons.stop-grace-ms", "1000",
            "qits.daemons.restart-backoff-initial-ms", "100");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private static final long AWAIT_MILLIS = 15_000;

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorktreeService worktreeService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject DaemonSupervisor supervisor;

  @Inject DaemonEventService daemonEventService;

  @Inject DaemonEventSpool daemonEventSpool;

  @Inject CommandService commandService;

  /** Clones the fixture and adds a {@code work} worktree (off master) to run daemons in. */
  private String repoWithWorktree() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Daemon Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    worktreeService.createWorktree(repo.id, "work", "master", "work");
    return repo.id;
  }

  private String createDaemon(
      String repoId,
      String name,
      String script,
      String readyPattern,
      RestartPolicy policy,
      int maxRestarts) {
    return repositoryDaemonService.create(
            repoId, name, null, script, readyPattern, "TERM", policy, maxRestarts, null, null)
        .id;
  }

  private DaemonInstanceDto awaitStatus(String repoId, String daemonId, DaemonStatus expected)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
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

  private DaemonInstanceDto instanceOf(String repoId, String daemonId) {
    return supervisor.effectiveDaemons(repoId, "work").stream()
        .filter(i -> i.daemon().id().equals(daemonId))
        .findFirst()
        .orElse(null);
  }

  @Test
  public void readyPatternFlipsStartingToReadyAndStopIsGraceful() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId =
        createDaemon(
            repoId,
            "ticker",
            "while true; do echo tick; sleep 0.2; done",
            "tick",
            RestartPolicy.NEVER,
            0);

    DaemonInstanceDto started = supervisor.start(repoId, "work", daemonId);
    assertEquals(DaemonStatus.STARTING, started.status());

    DaemonInstanceDto ready = awaitStatus(repoId, daemonId, DaemonStatus.READY);
    assertEquals(0, ready.restartCount());
    CommandDto command = commandService.get(ready.commandId());
    assertEquals(CommandKind.DAEMON, command.kind());

    supervisor.stop(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
  }

  @Test
  public void onFailureRelaunchesWithANewCommandThenSettlesCrashed() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId =
        createDaemon(repoId, "flaky", "echo boom; exit 7", null, RestartPolicy.ON_FAILURE, 1);

    supervisor.start(repoId, "work", daemonId);
    DaemonInstanceDto crashed = awaitStatus(repoId, daemonId, DaemonStatus.CRASHED);

    assertEquals(1, crashed.restartCount(), "one relaunch before giving up");
    List<CommandDto> daemonRuns =
        commandService.list(repoId, null).stream()
            .filter(c -> c.kind() == CommandKind.DAEMON)
            .toList();
    assertEquals(2, daemonRuns.size(), "each relaunch is its own command row: " + daemonRuns);
    assertNotEquals(daemonRuns.get(0).id(), daemonRuns.get(1).id());

    // The crash produced events: a CRASHED transition carrying the output tail as evidence, and
    // (with no chat running) an agent message spooled for the next session.
    List<DaemonEventDto> events = daemonEventService.recent(repoId, "work");
    DaemonEventDto crashEvent =
        events.stream()
            .filter(
                e ->
                    e.kind() == DaemonEventKind.STATUS_CHANGED
                        && e.status() == DaemonStatus.CRASHED)
            .findFirst()
            .orElseThrow(() -> new AssertionError("no CRASHED event: " + events));
    assertTrue(
        crashEvent.logExcerpt() != null && crashEvent.logExcerpt().contains("boom"),
        "crash event carries the output tail: " + crashEvent);
    List<String> spooled = daemonEventSpool.drain(repoId, "work");
    assertTrue(
        spooled.stream().anyMatch(m -> m.startsWith("[daemon:flaky]")),
        "agent message spooled while no chat runs: " + spooled);
  }

  @Test
  public void neverPolicySettlesCrashedWithoutRelaunch() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId = createDaemon(repoId, "oneshot", "exit 3", null, RestartPolicy.NEVER, 3);

    supervisor.start(repoId, "work", daemonId);
    DaemonInstanceDto crashed = awaitStatus(repoId, daemonId, DaemonStatus.CRASHED);

    assertEquals(0, crashed.restartCount());
    long daemonRuns =
        commandService.list(repoId, null).stream()
            .filter(c -> c.kind() == CommandKind.DAEMON)
            .count();
    assertEquals(1, daemonRuns);
  }

  @Test
  public void cleanExitUnderOnFailureStopsWithoutRestart() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId = createDaemon(repoId, "clean", "echo done", null, RestartPolicy.ON_FAILURE, 3);

    supervisor.start(repoId, "work", daemonId);
    DaemonInstanceDto stopped = awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    assertEquals(0, stopped.restartCount());
  }

  @Test
  public void stopBeatsAlwaysRestartPolicy() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId = createDaemon(repoId, "stubborn", "sleep 300", null, RestartPolicy.ALWAYS, 5);

    supervisor.start(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, DaemonStatus.READY); // grace-period readiness (no pattern)

    supervisor.stop(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);

    // Give a would-be restart a moment to (wrongly) happen, then confirm it stayed stopped.
    Thread.sleep(500);
    assertEquals(DaemonStatus.STOPPED, instanceOf(repoId, daemonId).status());
    long daemonRuns =
        commandService.list(repoId, null).stream()
            .filter(c -> c.kind() == CommandKind.DAEMON)
            .count();
    assertEquals(1, daemonRuns, "an explicit stop must not trigger the ALWAYS policy");
  }

  @Test
  public void oneRunningInstancePerWorktreeAndDaemon() throws Exception {
    String repoId = repoWithWorktree();
    String daemonId = createDaemon(repoId, "single", "sleep 300", null, RestartPolicy.NEVER, 0);

    supervisor.start(repoId, "work", daemonId);
    try {
      assertThrows(
          BadRequestException.class,
          () -> supervisor.start(repoId, "work", daemonId),
          "second start of the same (worktree, daemon) must be rejected");
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }
}
