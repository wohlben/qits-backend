package eu.wohlben.qits.domain.daemon.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.HealthCheckKind;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.repository.control.RepositoryService;
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
 * Web-view configuration semantics on daemon create/update: path normalization, lexical rejection,
 * the per-field merge on update, and 0-clears — the all-null embeddable must read back as an absent
 * {@code webView} (not web-viewable).
 */
@QuarkusTest
@TestProfile(RepositoryDaemonServiceTest.TestProfile.class)
public class RepositoryDaemonServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-daemon-crud-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject ProjectService projectService;

  @Inject RepositoryService repositoryService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  private String repo() throws Exception {
    String fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
    var project = projectService.create("Daemon CRUD Project", null);
    return repositoryService.cloneRepository(fixtureUrl, null, project).id;
  }

  private String createWebViewDaemon(
      String repoId, Integer port, String entryPath, String basePath) {
    return repositoryDaemonService.create(
            repoId,
            "web",
            null,
            "sleep 300",
            null,
            "TERM",
            null,
            null,
            null,
            null,
            port,
            entryPath,
            basePath,
            null,
            null,
            null,
            null)
        .id;
  }

  @Test
  public void createNormalizesPathsAndRoundTrips() throws Exception {
    String repoId = repo();
    String daemonId = createWebViewDaemon(repoId, 4200, "/greeting/", "app/");

    RepositoryDaemonDto dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(4200, dto.webView().port());
    assertEquals("greeting", dto.webView().entryPath(), "paths are stored slash-less");
    assertEquals("app", dto.webView().basePath());
  }

  @Test
  public void createWithoutWebViewIsNotWebViewable() throws Exception {
    String repoId = repo();
    String daemonId = createWebViewDaemon(repoId, null, null, null);

    assertNull(repositoryDaemonService.resolve(repoId, daemonId).webView());
  }

  @Test
  public void createRejectsInvalidWebViewConfig() throws Exception {
    String repoId = repo();

    assertThrows(
        BadRequestException.class,
        () -> createWebViewDaemon(repoId, 70000, null, null),
        "out-of-range port");
    assertThrows(
        BadRequestException.class,
        () -> createWebViewDaemon(repoId, 4200, "../escape", null),
        "traversal entry path");
    assertThrows(
        BadRequestException.class,
        () -> createWebViewDaemon(repoId, 4200, null, "has space"),
        "whitespace lands in an env var / URL");
    assertThrows(
        BadRequestException.class,
        () -> createWebViewDaemon(repoId, null, "greeting", null),
        "a path without a port is not web-viewable");
  }

  @Test
  public void updateMergesWebViewPerField() throws Exception {
    String repoId = repo();
    String daemonId = createWebViewDaemon(repoId, 4200, "greeting", null);

    // Only the entry path: the port carries over.
    repositoryDaemonService.update(
        repoId, daemonId, null, null, null, null, null, null, null, null, null, null, "welcome",
        null, null, null, null, null);
    RepositoryDaemonDto dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(4200, dto.webView().port());
    assertEquals("welcome", dto.webView().entryPath());

    // Only the port: the entry path carries over.
    repositoryDaemonService.update(
        repoId, daemonId, null, null, null, null, null, null, null, null, null, 8080, null, null,
        null, null, null, null);
    dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(8080, dto.webView().port());
    assertEquals("welcome", dto.webView().entryPath());

    // A blank path arg clears just that field.
    repositoryDaemonService.update(
        repoId, daemonId, null, null, null, null, null, null, null, null, null, null, "", null,
        null, null, null, null);
    dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(8080, dto.webView().port());
    assertNull(dto.webView().entryPath());
  }

  @Test
  public void updatePortZeroClearsTheWholeBlock() throws Exception {
    String repoId = repo();
    String daemonId = createWebViewDaemon(repoId, 4200, "greeting", "app");

    repositoryDaemonService.update(
        repoId, daemonId, null, null, null, null, null, null, null, null, null, 0, null, null, null,
        null, null, null);

    assertNull(
        repositoryDaemonService.resolve(repoId, daemonId).webView(),
        "the cleared (all-null) embeddable reads back as absent");
  }

  @Test
  public void updateWithAllNullWebViewArgsKeepsTheConfig() throws Exception {
    String repoId = repo();
    String daemonId = createWebViewDaemon(repoId, 4200, "greeting", null);

    repositoryDaemonService.update(
        repoId, daemonId, "renamed", null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null);

    RepositoryDaemonDto dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(4200, dto.webView().port());
    assertEquals("greeting", dto.webView().entryPath());
  }

  // --- Healthchecks: ordered round-trip, update semantics, per-kind validation -----------------

  private String createHealthCheckDaemon(String repoId, List<HealthCheck> healthChecks) {
    return repositoryDaemonService.create(
            repoId,
            "checked",
            null,
            "sleep 300",
            null,
            "TERM",
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            healthChecks)
        .id;
  }

  private static HealthCheck http(String name, int port, String path, String expectStatus) {
    return new HealthCheck(
        name, HealthCheckKind.HTTP, port, path, expectStatus, null, null, null, null, null, null);
  }

  @Test
  public void healthChecksRoundTripInDeclarationOrder() throws Exception {
    String repoId = repo();
    String daemonId =
        createHealthCheckDaemon(
            repoId,
            List.of(
                http("Quarkus", 8080, "/q/health", null),
                new HealthCheck(
                    "Angular",
                    HealthCheckKind.TCP,
                    4200,
                    null,
                    null,
                    null,
                    2500L,
                    1000L,
                    2,
                    5,
                    15000L)));

    RepositoryDaemonDto dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(2, dto.healthChecks().size());
    assertEquals("Quarkus", dto.healthChecks().get(0).name());
    assertEquals(HealthCheckKind.HTTP, dto.healthChecks().get(0).kind());
    assertEquals("/q/health", dto.healthChecks().get(0).path());
    assertEquals("Angular", dto.healthChecks().get(1).name());
    assertEquals(2500L, dto.healthChecks().get(1).intervalMs());
    assertEquals(5, dto.healthChecks().get(1).unhealthyThreshold());
  }

  @Test
  public void updateReplacesHealthChecksWhollyAndNullKeeps() throws Exception {
    String repoId = repo();
    String daemonId = createHealthCheckDaemon(repoId, List.of(http("old", 8080, null, null)));

    // Null = keep as-is (the observers convention).
    repositoryDaemonService.update(
        repoId, daemonId, "renamed", null, null, null, null, null, null, null, null, null, null,
        null, null, null, null, null);
    assertEquals(
        "old", repositoryDaemonService.resolve(repoId, daemonId).healthChecks().get(0).name());

    // A present list replaces the whole collection.
    repositoryDaemonService.update(
        repoId,
        daemonId,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        List.of(http("new", 9090, "/", null)));
    RepositoryDaemonDto dto = repositoryDaemonService.resolve(repoId, daemonId);
    assertEquals(1, dto.healthChecks().size());
    assertEquals("new", dto.healthChecks().get(0).name());
    assertEquals(9090, dto.healthChecks().get(0).port());
  }

  @Test
  public void createRejectsInvalidHealthChecks() throws Exception {
    String repoId = repo();

    assertThrows(
        BadRequestException.class,
        () ->
            createHealthCheckDaemon(
                repoId, List.of(http("dup", 8080, null, null), http("dup", 4200, null, null))),
        "duplicate check name");
    assertThrows(
        BadRequestException.class,
        () ->
            createHealthCheckDaemon(
                repoId,
                List.of(
                    new HealthCheck(
                        "portless",
                        HealthCheckKind.HTTP,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null))),
        "HTTP without a port");
    assertThrows(
        BadRequestException.class,
        () ->
            createHealthCheckDaemon(
                repoId,
                List.of(
                    new HealthCheck(
                        "mixed",
                        HealthCheckKind.TCP,
                        4200,
                        null,
                        null,
                        "echo no",
                        null,
                        null,
                        null,
                        null,
                        null))),
        "a command on a TCP check");
    assertThrows(
        BadRequestException.class,
        () -> createHealthCheckDaemon(repoId, List.of(http("bad-expect", 8080, null, "6xx"))),
        "invalid expectStatus token");
    assertThrows(
        BadRequestException.class,
        () -> createHealthCheckDaemon(repoId, List.of(http("bad-path", 8080, "no-slash", null))),
        "path must start with /");
    assertThrows(
        BadRequestException.class,
        () ->
            createHealthCheckDaemon(
                repoId,
                List.of(
                    new HealthCheck(
                        "commandless",
                        HealthCheckKind.COMMAND,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null))),
        "COMMAND without a command");
    assertThrows(
        BadRequestException.class,
        () ->
            createHealthCheckDaemon(
                repoId,
                List.of(
                    new HealthCheck(
                        "too-fast",
                        HealthCheckKind.TCP,
                        4200,
                        null,
                        null,
                        null,
                        50L,
                        null,
                        null,
                        null,
                        null))),
        "interval below the floor");
  }
}
