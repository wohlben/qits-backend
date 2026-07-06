package eu.wohlben.qits.domain.daemon.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.LogSeverity;
import eu.wohlben.qits.domain.daemon.dto.DaemonEventDto;
import eu.wohlben.qits.domain.daemon.dto.DaemonInstanceDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventKind;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.DaemonStatus;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
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
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;

/**
 * Drives the supervisor state machine against real processes in a cloned-fixture workspace:
 * readiness via pattern and grace, the restart policies (with new Command rows per relaunch),
 * graceful stop, and the singleton-per-(workspace, daemon) rule.
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
            // Test-speed supervisor timing: fast grace-READY, fast restart backoff, fast tail.
            "qits.daemons.ready-grace-ms", "300",
            "qits.daemons.stop-grace-ms", "1000",
            "qits.daemons.restart-backoff-initial-ms", "100",
            "qits.daemons.file-tail-poll-ms", "100",
            // Fast crash/exit detection so the state machine tests don't wait on the 2s prod poll.
            "qits.daemons.liveness-poll-ms", "150");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private static final long AWAIT_MILLIS = 15_000;

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorkspaceService workspaceService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject DaemonSupervisor supervisor;

  @Inject DaemonEventService daemonEventService;

  @Inject DaemonEventSpool daemonEventSpool;

  @Inject CommandService commandService;

  @Inject ContainerRuntime containers;

  /** Clones the fixture and adds a {@code work} workspace (off master) to run daemons in. */
  private String repoWithWorkspace() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Daemon Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    workspaceService.createWorkspace(repo.id, "work", "master", "work");
    return repo.id;
  }

  private String createDaemon(
      String repoId,
      String name,
      String script,
      String readyPattern,
      RestartPolicy policy,
      int maxRestarts) {
    return createDaemon(repoId, name, script, readyPattern, policy, maxRestarts, null, null);
  }

  private String createDaemon(
      String repoId,
      String name,
      String script,
      String readyPattern,
      RestartPolicy policy,
      int maxRestarts,
      List<LogObserver> observers,
      List<LogSource> sources) {
    return repositoryDaemonService.create(
            repoId,
            name,
            null,
            script,
            readyPattern,
            "TERM",
            policy,
            maxRestarts,
            null,
            null,
            null,
            null,
            null,
            observers,
            sources)
        .id;
  }

  private DaemonEventDto awaitEvent(String repoId, Predicate<DaemonEventDto> predicate)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    List<DaemonEventDto> last = List.of();
    while (System.currentTimeMillis() < deadline) {
      last = daemonEventService.query(repoId, "work", null, null, null, 0, 200);
      var match = last.stream().filter(predicate).findFirst();
      if (match.isPresent()) {
        return match.get();
      }
      Thread.sleep(100);
    }
    throw new AssertionError("Timed out waiting for a matching event; events: " + last);
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
    String repoId = repoWithWorkspace();
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
    String repoId = repoWithWorkspace();
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
    List<DaemonEventDto> events =
        daemonEventService.query(repoId, "work", null, null, null, 0, 100);
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
    String repoId = repoWithWorkspace();
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
    String repoId = repoWithWorkspace();
    String daemonId = createDaemon(repoId, "clean", "echo done", null, RestartPolicy.ON_FAILURE, 3);

    supervisor.start(repoId, "work", daemonId);
    DaemonInstanceDto stopped = awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    assertEquals(0, stopped.restartCount());
  }

  @Test
  public void stopBeatsAlwaysRestartPolicy() throws Exception {
    String repoId = repoWithWorkspace();
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
  public void fileSourceFindingsCarrySourceAndAnchorAndLateFilesArePickedUp() throws Exception {
    String repoId = repoWithWorkspace();
    // The daemon stays quiet on stdout and logs into app.log — which doesn't exist until ~1s in,
    // covering the late-appearing-file case (its first line must still be observed as line 1).
    String daemonId =
        createDaemon(
            repoId,
            "filelogger",
            "sleep 1; { echo 'starting up'; echo 'ERROR: kaboom in module'; } >> app.log;"
                + " sleep 300",
            null,
            RestartPolicy.NEVER,
            0,
            List.of(new LogObserver(LogObserverKind.LOG_LEVEL, null, null)),
            List.of(new LogSource("app.log", null)));

    supervisor.start(repoId, "work", daemonId);
    try {
      DaemonEventDto event = awaitEvent(repoId, e -> "app.log".equals(e.source()));
      assertEquals(DaemonEventKind.ERROR_DETECTED, event.kind());
      assertEquals(DaemonEventSeverity.ERROR, event.severity());
      assertEquals("ERROR: kaboom in module", event.logExcerpt());
      assertEquals(2, event.anchorFrom().longValue(), "the ERROR is the file's second line");
      assertEquals(2, event.anchorTo().longValue());
      assertTrue(event.sourceEpoch() != null, "file anchors carry the tail's rotation epoch");
      // The agent message names the file the evidence came from.
      List<String> spooled = daemonEventSpool.drain(repoId, "work");
      assertTrue(
          spooled.stream().anyMatch(m -> m.startsWith("[daemon:filelogger:app.log] ERROR")),
          "agent message carries the source: " + spooled);
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }

  @Test
  public void outputFindingsAnchorToPersistedLogSequencesAndLinesCarrySeverity() throws Exception {
    String repoId = repoWithWorkspace();
    String daemonId =
        createDaemon(
            repoId,
            "stdout-logger",
            "echo 'warming up'; echo 'ERROR: exploded here'; sleep 300",
            null,
            RestartPolicy.NEVER,
            0,
            List.of(new LogObserver(LogObserverKind.LOG_LEVEL, null, null)),
            null);

    supervisor.start(repoId, "work", daemonId);
    try {
      DaemonEventDto event = awaitEvent(repoId, e -> "output".equals(e.source()));
      assertEquals(DaemonEventKind.ERROR_DETECTED, event.kind());

      // The anchor references command_log_line sequences: resolving it against the persisted log
      // yields exactly the excerpt's lines.
      List<CommandLogLineDto> anchored =
          awaitLogLines(
              event.commandId(),
              line -> line.sequence() >= event.anchorFrom() && line.sequence() <= event.anchorTo());
      assertEquals(
          event.logExcerpt(),
          String.join("\n", anchored.stream().map(CommandLogLineDto::content).toList()),
          "the excerpt equals the anchored lines' content");

      // Per-line severity is stamped where lines are persisted; ?severity=ERROR is exactly those.
      List<CommandLogLineDto> errorLines =
          awaitLogLines(event.commandId(), l -> l.severity() == LogSeverity.ERROR);
      assertTrue(
          errorLines.stream().allMatch(l -> l.content().contains("ERROR: exploded here")),
          "only the classified line carries ERROR: " + errorLines);
      assertEquals(
          errorLines,
          commandService.log(event.commandId(), LogSeverity.ERROR),
          "the severity filter returns exactly the stamped lines");
      assertTrue(
          commandService.log(event.commandId(), null).stream()
              .filter(l -> l.content().contains("warming up"))
              .allMatch(l -> l.severity() == null),
          "routine lines stay unclassified");
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }

  private List<CommandLogLineDto> awaitLogLines(
      String commandId, Predicate<CommandLogLineDto> predicate) throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    while (System.currentTimeMillis() < deadline) {
      List<CommandLogLineDto> matching =
          commandService.log(commandId, null).stream().filter(predicate).toList();
      if (!matching.isEmpty()) {
        return matching;
      }
      Thread.sleep(100);
    }
    throw new AssertionError("Timed out waiting for matching log lines of " + commandId);
  }

  @Test
  public void webViewableDaemonExposesProxyTargetAndPath() throws Exception {
    // Definition first: the container (created with the workspace below) publishes the port only
    // when the daemon already declares it at creation time.
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Proxy Daemon Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    String daemonId =
        repositoryDaemonService.create(
                repo.id,
                "web",
                null,
                "sleep 300",
                null,
                "TERM",
                RestartPolicy.NEVER,
                0,
                null,
                8123,
                "greeting",
                "app",
                null,
                null,
                null)
            .id;
    workspaceService.createWorkspace(repo.id, "work", "master", "work");

    supervisor.start(repo.id, "work", daemonId);
    try {
      DaemonInstanceDto ready = awaitStatus(repo.id, daemonId, DaemonStatus.READY);
      assertEquals(
          "/daemon/work/" + daemonId + "/app/",
          ready.proxyPath(),
          "the served base is the proxy prefix plus the basePath (entryPath is not part of it)");
      assertEquals(
          "greeting",
          ready.daemon().webView().entryPath(),
          "the definition's entry path rides along on the instance DTO");
      assertEquals(
          false,
          ready.needsContainerRecreate(),
          "the container publishes the port, so no recreation is needed");

      var target = supervisor.proxyTarget("work", daemonId);
      assertTrue(target.isPresent(), "a live web-viewable daemon has a proxy target");
      assertEquals(DaemonStatus.READY, target.get().status());
      // FakeContainerRuntime maps published ports 1:1 (fake containers are host processes).
      assertEquals(8123, target.get().hostPort());

      assertTrue(
          supervisor.proxyTarget("work", "no-such-daemon").isEmpty(),
          "unknown daemon id resolves to nothing");
    } finally {
      supervisor.stop(repo.id, "work", daemonId);
      awaitStatus(repo.id, daemonId, DaemonStatus.STOPPED);
    }

    var stopped = supervisor.proxyTarget("work", daemonId);
    assertTrue(stopped.isPresent(), "a stopped instance still resolves (the proxy 502s on it)");
    assertEquals(DaemonStatus.STOPPED, stopped.get().status());
  }

  @Test
  public void daemonWithoutWebViewHasNoProxyTargetOrPath() throws Exception {
    String repoId = repoWithWorkspace();
    String daemonId = createDaemon(repoId, "plain", "sleep 300", null, RestartPolicy.NEVER, 0);

    supervisor.start(repoId, "work", daemonId);
    try {
      DaemonInstanceDto ready = awaitStatus(repoId, daemonId, DaemonStatus.READY);
      assertEquals(null, ready.proxyPath(), "no web-view config, no proxy path");
      assertTrue(supervisor.proxyTarget("work", daemonId).isEmpty());
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }

  @Test
  public void containerPredatingTheWebViewPortWarnsAndLeavesTheWebViewUnavailable()
      throws Exception {
    // Workspace (and thus container) first, definition second: the container cannot publish the
    // port, so the daemon runs but the web view stays unavailable until a recreation.
    String repoId = repoWithWorkspace();
    String daemonId =
        repositoryDaemonService.create(
                repoId,
                "late-port",
                null,
                "sleep 300",
                null,
                "TERM",
                RestartPolicy.NEVER,
                0,
                null,
                8124,
                null,
                null,
                null,
                null,
                null)
            .id;

    supervisor.start(repoId, "work", daemonId);
    try {
      DaemonInstanceDto ready = awaitStatus(repoId, daemonId, DaemonStatus.READY);
      assertEquals(
          true,
          ready.needsContainerRecreate(),
          "a live web-viewable daemon with an unpublished port flags the recreation");
      var target = supervisor.proxyTarget("work", daemonId);
      assertTrue(target.isPresent(), "the instance resolves — with an unpublished port");
      assertEquals(null, target.get().hostPort(), "no published port on a predating container");
      awaitEvent(
          repoId,
          e ->
              e.severity() == DaemonEventSeverity.WARNING
                  && e.summary() != null
                  && e.summary().contains("recreate the container"));
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }

  @Test
  public void relaunchReapsAStragglerThatEscapedTheProcessGroup() throws Exception {
    // Regression for the orphaned forked-JVM wedge: a stop group-kills the launched process group,
    // but a child that put itself in a NEW session (setsid — exactly what Quarkus dev mode's forked
    // application JVM effectively does relative to `kill -- -pgid`) survives. It keeps binding the
    // http port, so the NEXT start collides and sits in STARTING forever. The launch-time reap must
    // kill it first, by the QITS_DAEMON_ID marker its environ inherited.
    String repoId = repoWithWorkspace();
    Path orphanPidFile = Files.createTempFile("qits-orphan-", ".pid");
    Files.deleteIfExists(
        orphanPidFile); // the script (re)creates it; absence means "not written yet"
    // The setsid child inherits the daemon's environment (incl. the marker) and escapes the group.
    // The leader waits so the daemon is a normal long-runner until stopped.
    String script =
        "setsid bash -c 'echo $$ > "
            + orphanPidFile
            + "; sleep 30' &"
            + " until [ -s "
            + orphanPidFile
            + " ]; do sleep 0.05; done; echo ready; sleep 300";
    String daemonId = createDaemon(repoId, "escaper", script, "ready", RestartPolicy.NEVER, 0);

    supervisor.start(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, DaemonStatus.READY);
    supervisor.stop(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);

    long orphanPid = Long.parseLong(Files.readString(orphanPidFile).trim());
    assertTrue(
        ProcessHandle.of(orphanPid).map(ProcessHandle::isAlive).orElse(false),
        "the setsid child survives the group-kill stop (the bug being fixed)");

    try {
      // Relaunching must reap the straggler before the new run starts.
      supervisor.start(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.READY);

      long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
      boolean reaped = false;
      while (System.currentTimeMillis() < deadline) {
        if (ProcessHandle.of(orphanPid).map(ProcessHandle::isAlive).orElse(false) == false) {
          reaped = true;
          break;
        }
        Thread.sleep(50);
      }
      assertTrue(
          reaped, "the escaped straggler is killed on relaunch by its QITS_DAEMON_ID marker");
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
      // The second run forked its own setsid child; best-effort reap so the test leaves nothing.
      try {
        long second = Long.parseLong(Files.readString(orphanPidFile).trim());
        ProcessHandle.of(second).ifPresent(ProcessHandle::destroyForcibly);
      } catch (Exception ignored) {
        // best effort
      }
      Files.deleteIfExists(orphanPidFile);
    }
  }

  @Test
  public void reconcileAdoptsADaemonStillRunningFromBeforeARestart() throws Exception {
    // The core durability guarantee: a daemon whose detached session outlived a qits restart is
    // re-adopted (not shown STOPPED). Simulate it by starting a session directly, with no
    // supervisor
    // instance tracking it — exactly the state a fresh JVM sees — then let the first
    // effectiveDaemons
    // probe (via awaitStatus -> instanceOf) find the live session and adopt it as READY.
    String repoId = repoWithWorkspace();
    String script = "while true; do echo alive; sleep 0.3; done";
    String daemonId = createDaemon(repoId, "survivor", script, "alive", RestartPolicy.NEVER, 0);
    String container = containers.containerName("work", repoId);
    containers.startDaemon(container, daemonId, script, Map.of("QITS_DAEMON_ID", daemonId));
    assertTrue(containers.daemonAlive(container, daemonId), "the out-of-band session is running");

    try {
      DaemonInstanceDto adopted = awaitStatus(repoId, daemonId, DaemonStatus.READY);
      assertEquals(DaemonStatus.READY, adopted.status(), "the live session is adopted as READY");
      assertTrue(
          containers.daemonAlive(container, daemonId), "the session keeps running after adoption");
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
      assertTrue(!containers.daemonAlive(container, daemonId), "stop tears the session down");
    }
  }

  @Test
  public void oneRunningInstancePerWorkspaceAndDaemon() throws Exception {
    String repoId = repoWithWorkspace();
    String daemonId = createDaemon(repoId, "single", "sleep 300", null, RestartPolicy.NEVER, 0);

    supervisor.start(repoId, "work", daemonId);
    try {
      assertThrows(
          BadRequestException.class,
          () -> supervisor.start(repoId, "work", daemonId),
          "second start of the same (workspace, daemon) must be rejected");
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, DaemonStatus.STOPPED);
    }
  }
}
