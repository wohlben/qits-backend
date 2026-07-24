package eu.wohlben.qits.domain.service.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.daemon.dto.HealthCheckState;
import eu.wohlben.qits.domain.daemon.dto.HealthCheckStatusDto;
import eu.wohlben.qits.domain.daemon.entity.HealthCheckKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.FakeWorkspaceConfigReader;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.service.dto.ServiceEventDto;
import eu.wohlben.qits.domain.service.dto.ServiceInstanceDto;
import eu.wohlben.qits.domain.service.entity.ServiceStatus;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Drives healthchecks end-to-end through the supervisor against real host processes (the fake
 * container runtime executes probes as real commands): kind-specific probing (COMMAND exit codes,
 * TCP connects against a really-bound port, HTTP status matching against a real server), threshold
 * debouncing, the display-only invariant (a red check never moves {@code ServiceStatus} and never
 * writes a {@code daemon_event} row), stop/adopt lifecycle, and UNKNOWN-vs-UNHEALTHY
 * classification. Checks are config-declared ({@link QitsConfig.HealthCheckDecl} entries on the
 * staged {@link QitsConfig.ServiceDecl}); the probe runtime applies the same defaults the old DB
 * store did.
 */
@QuarkusTest
@TestProfile(HealthProbeServiceTest.TestProfile.class)
public class HealthProbeServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-health-test-repos");
        return Map.of(
            "qits.repositories.data-dir", tempDir.toString(),
            "qits.services.ready-grace-ms", "300",
            "qits.services.stop-grace-ms", "1000",
            "qits.services.restart-backoff-initial-ms", "100",
            "qits.services.liveness-poll-ms", "150",
            // Fast probe cadence so threshold flips land within the await windows.
            "qits.services.health-poll-ms", "100",
            "qits.services.health-timeout-ms", "1500");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private static final long AWAIT_MILLIS = 15_000;

  /** A daemon that stays alive and quiet — health is what's under test, not the lifecycle. */
  private static final String IDLE_SCRIPT = "while true; do echo tick; sleep 0.2; done";

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject WorkspaceService workspaceService;

  @Inject FakeWorkspaceConfigReader configReader;

  @Inject ServiceSupervisor supervisor;

  @Inject ServiceEventService daemonEventService;

  @Inject ContainerRuntime containers;

  @BeforeEach
  void resetConfig() {
    configReader.clear(); // the fake is a shared singleton across this class's test methods
  }

  private String repoWithWorkspace() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Health Project", null);
    var repo = repositoryService.cloneRepository(fixtureUrl, null, project);
    workspaceService.createWorkspace(repo.id, "work", "master", "work");
    workspaceService.ensureContainer(repo.id, "work");
    return repo.id;
  }

  private String createDaemon(
      String repoId, String name, List<QitsConfig.HealthCheckDecl> healthChecks) {
    configReader.setConfig(
        "work",
        new QitsConfig(
            null,
            null,
            null,
            List.of(
                new QitsConfig.ServiceDecl(
                    name,
                    name,
                    null,
                    IDLE_SCRIPT,
                    "tick",
                    null,
                    null,
                    RestartPolicy.NEVER,
                    0,
                    "TERM",
                    null,
                    null,
                    healthChecks)),
            null));
    return name;
  }

  /** A check with instant first probe and single-failure flips, unless a test tunes thresholds. */
  private static QitsConfig.HealthCheckDecl check(
      String name, HealthCheckKind kind, Integer port, String path, String expect, String command) {
    return new QitsConfig.HealthCheckDecl(
        name, kind, port, path, expect, command, null, null, null, 1, 0L);
  }

  private HealthCheckStatusDto awaitHealth(
      String repoId, String daemonId, String checkName, HealthCheckState expected)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    HealthCheckStatusDto last = null;
    while (System.currentTimeMillis() < deadline) {
      last = healthOf(repoId, daemonId, checkName);
      if (last != null && last.state() == expected) {
        return last;
      }
      Thread.sleep(50);
    }
    throw new AssertionError(
        "Timed out waiting for check '" + checkName + "' to be " + expected + "; last: " + last);
  }

  private HealthCheckStatusDto healthOf(String repoId, String daemonId, String checkName) {
    ServiceInstanceDto instance = instanceOf(repoId, daemonId);
    if (instance == null || instance.health() == null) {
      return null;
    }
    return instance.health().stream()
        .filter(h -> h.name().equals(checkName))
        .findFirst()
        .orElse(null);
  }

  private ServiceInstanceDto instanceOf(String repoId, String daemonId) {
    return supervisor.effectiveDaemons(repoId, "work").stream()
        .filter(i -> i.daemon().id().equals(daemonId))
        .findFirst()
        .orElse(null);
  }

  private ServiceInstanceDto awaitStatus(String repoId, String daemonId, ServiceStatus expected)
      throws InterruptedException {
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    ServiceInstanceDto last = null;
    while (System.currentTimeMillis() < deadline) {
      last = instanceOf(repoId, daemonId);
      if (last != null && last.status() == expected) {
        return last;
      }
      Thread.sleep(50);
    }
    throw new AssertionError("Timed out waiting for " + expected + "; last state: " + last);
  }

  @Test
  public void commandCheckDebouncesAndNeverTouchesLifecycleOrEvents() throws Exception {
    String repoId = repoWithWorkspace();
    Path flag = Files.createTempDirectory("qits-health-flag").resolve("healthy");
    // unhealthyThreshold 3: the flip to red needs three consecutive failed ticks.
    QitsConfig.HealthCheckDecl flagCheck =
        new QitsConfig.HealthCheckDecl(
            "flag",
            HealthCheckKind.COMMAND,
            null,
            null,
            null,
            "test -f " + flag,
            null,
            null,
            null,
            3,
            0L);
    String daemonId = createDaemon(repoId, "flagged", List.of(flagCheck));

    // Before any start: one UNKNOWN entry per declared check, no runtime data.
    ServiceInstanceDto stopped = instanceOf(repoId, daemonId);
    assertEquals(1, stopped.health().size());
    assertEquals(HealthCheckState.UNKNOWN, stopped.health().get(0).state());
    assertNull(stopped.health().get(0).lastCheckedAt());

    supervisor.start(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, ServiceStatus.READY);

    // Flag absent: three failed ticks debounce into UNHEALTHY, with the evidence cached.
    HealthCheckStatusDto unhealthy =
        awaitHealth(repoId, daemonId, "flag", HealthCheckState.UNHEALTHY);
    assertNotNull(unhealthy.lastCheckedAt());
    assertNotNull(unhealthy.lastLatencyMs());
    assertTrue(unhealthy.detail().startsWith("exit 1"), "failure evidence: " + unhealthy.detail());

    // The display-only invariant: a red check leaves the lifecycle READY...
    assertEquals(ServiceStatus.READY, instanceOf(repoId, daemonId).status());
    List<ServiceEventDto> events =
        daemonEventService.query(repoId, "work", null, null, null, 0, 100);

    Files.createFile(flag);
    awaitHealth(repoId, daemonId, "flag", HealthCheckState.HEALTHY);
    Files.delete(flag);
    awaitHealth(repoId, daemonId, "flag", HealthCheckState.UNHEALTHY);

    // ...and the whole healthy->unhealthy->healthy cycle persisted nothing: the event feed is
    // exactly what the launch produced.
    assertEquals(
        events,
        daemonEventService.query(repoId, "work", null, null, null, 0, 100),
        "health flips must not write daemon_event rows");

    supervisor.stop(repoId, "work", daemonId);
    ServiceInstanceDto afterStop = awaitStatus(repoId, daemonId, ServiceStatus.STOPPED);
    // Stop cancels the probes and drops the runtime state — grey dots, not a stale red.
    assertEquals(HealthCheckState.UNKNOWN, afterStop.health().get(0).state());
    assertNull(afterStop.health().get(0).lastCheckedAt());
  }

  @Test
  public void tcpCheckTracksARealPort() throws Exception {
    String repoId = repoWithWorkspace();
    try (ServerSocket socket = new ServerSocket(0)) {
      int port = socket.getLocalPort();
      String daemonId =
          createDaemon(
              repoId, "tcp", List.of(check("sock", HealthCheckKind.TCP, port, null, null, null)));
      supervisor.start(repoId, "work", daemonId);
      awaitHealth(repoId, daemonId, "sock", HealthCheckState.HEALTHY);

      socket.close();
      HealthCheckStatusDto down = awaitHealth(repoId, daemonId, "sock", HealthCheckState.UNHEALTHY);
      assertNotNull(down.detail());

      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, ServiceStatus.STOPPED);
    }
  }

  @Test
  public void httpChecksMatchStatusAgainstExpectations() throws Exception {
    String repoId = repoWithWorkspace();
    com.sun.net.httpserver.HttpServer server =
        com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/ok", exchange -> respond(exchange, 200));
    server.createContext("/bad", exchange -> respond(exchange, 503));
    server.start();
    try {
      int port = server.getAddress().getPort();
      String daemonId =
          createDaemon(
              repoId,
              "http",
              List.of(
                  check("ok", HealthCheckKind.HTTP, port, "/ok", null, null),
                  check("bad", HealthCheckKind.HTTP, port, "/bad", null, null),
                  check("bad-expected", HealthCheckKind.HTTP, port, "/bad", "503", null)));
      supervisor.start(repoId, "work", daemonId);

      HealthCheckStatusDto ok = awaitHealth(repoId, daemonId, "ok", HealthCheckState.HEALTHY);
      assertEquals("HTTP 200", ok.detail());

      HealthCheckStatusDto bad = awaitHealth(repoId, daemonId, "bad", HealthCheckState.UNHEALTHY);
      assertTrue(bad.detail().contains("HTTP 503"), "status evidence: " + bad.detail());
      assertTrue(bad.detail().contains("expected 2xx,3xx"), "expectation shown: " + bad.detail());

      // An explicit expectStatus turns the same 503 answer healthy — matching, not hardcoding.
      awaitHealth(repoId, daemonId, "bad-expected", HealthCheckState.HEALTHY);

      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, ServiceStatus.STOPPED);
    } finally {
      server.stop(0);
    }
  }

  @Test
  public void probeThatCannotRunReadsUnknownNotUnhealthy() throws Exception {
    String repoId = repoWithWorkspace();
    String daemonId =
        createDaemon(
            repoId,
            "broken-probe",
            List.of(
                check(
                    "missing-tool",
                    HealthCheckKind.COMMAND,
                    null,
                    null,
                    null,
                    "definitely-not-a-binary-qits-health")));
    supervisor.start(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, ServiceStatus.READY);

    // The probe runs (lastCheckedAt moves) but exit 127 is "couldn't tell", never a red dot.
    long deadline = System.currentTimeMillis() + AWAIT_MILLIS;
    HealthCheckStatusDto last = null;
    while (System.currentTimeMillis() < deadline) {
      last = healthOf(repoId, daemonId, "missing-tool");
      if (last != null && last.lastCheckedAt() != null) {
        break;
      }
      Thread.sleep(50);
    }
    assertNotNull(last.lastCheckedAt(), "the probe ticked: " + last);
    assertEquals(HealthCheckState.UNKNOWN, last.state(), "a broken probe is not a down service");

    supervisor.stop(repoId, "work", daemonId);
    awaitStatus(repoId, daemonId, ServiceStatus.STOPPED);
  }

  @Test
  public void adoptedDaemonReprobesImmediately() throws Exception {
    // A daemon surviving a qits restart is re-adopted with no supervisor state; its checks restart
    // from UNKNOWN and (with the boot grace skipped on adoption) repopulate within one interval.
    String repoId = repoWithWorkspace();
    String daemonId =
        createDaemon(
            repoId,
            "survivor",
            List.of(check("always", HealthCheckKind.COMMAND, null, null, null, "true")));
    String container = containers.containerName("work", repoId);
    containers.startDaemon(container, daemonId, IDLE_SCRIPT, Map.of("QITS_SERVICE_ID", daemonId));

    try {
      awaitStatus(repoId, daemonId, ServiceStatus.READY);
      awaitHealth(repoId, daemonId, "always", HealthCheckState.HEALTHY);
    } finally {
      supervisor.stop(repoId, "work", daemonId);
      awaitStatus(repoId, daemonId, ServiceStatus.STOPPED);
    }
  }

  private static void respond(com.sun.net.httpserver.HttpExchange exchange, int status)
      throws IOException {
    byte[] body = "probe".getBytes();
    exchange.sendResponseHeaders(status, body.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(body);
    }
  }
}
