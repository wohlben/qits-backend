package eu.wohlben.qits.domain.daemon.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import eu.wohlben.qits.domain.daemon.api.RepositoryDaemonController.CreateRepositoryDaemonRequest;
import eu.wohlben.qits.domain.daemon.api.RepositoryDaemonController.UpdateRepositoryDaemonRequest;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.project.api.ProjectController;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * CRUD round-trip over a repository's daemons — the only scope daemons have (there is no global
 * daemon library) — including ownership enforcement across repositories.
 */
@QuarkusTest
@TestProfile(RepositoryDaemonControllerTest.TestProfile.class)
public class RepositoryDaemonControllerTest {

  /** Isolate cloned repos in a temp dir, like the other repository-backed tests. */
  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-daemon-controller-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public RepositoryDaemonControllerTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private String createRepository() {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(new ProjectController.CreateProjectRequest("Daemon Project", null))
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRepositoryRequest(fixtureUrl, null))
        .post("/api/projects/" + projectId + "/repositories")
        .then()
        .statusCode(200)
        .extract()
        .path("repository.id");
  }

  private String create(String repoId, String name) {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateRepositoryDaemonRequest(
                name,
                "a dev server",
                "npm run dev",
                "Listening on.*:3000",
                "SIGINT",
                RestartPolicy.ALWAYS,
                false, // autoStart — non-default, to prove the flag threads through
                5,
                true,
                new WebViewInput(5173, "/greeting/", null),
                Map.of("PORT", "3000"),
                List.of(
                    new LogObserverInput(
                        LogObserverKind.PATTERN, "ERROR", DaemonEventSeverity.ERROR),
                    new LogObserverInput(LogObserverKind.LOG_LEVEL, null, null)),
                List.of(new LogSourceInput("logs/app.log", "app log"))))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(200)
        .body("daemon.name", equalTo(name))
        .body("daemon.startScript", equalTo("npm run dev"))
        .body("daemon.readyPattern", equalTo("Listening on.*:3000"))
        .body("daemon.stopSignal", equalTo("INT"))
        .body("daemon.restartPolicy", equalTo("ALWAYS"))
        .body("daemon.autoStart", equalTo(false))
        .body("daemon.maxRestarts", equalTo(5))
        .body("daemon.otel", equalTo(true))
        .body("daemon.webView.port", equalTo(5173))
        .body("daemon.webView.entryPath", equalTo("greeting")) // normalized slash-less
        .body("daemon.webView.basePath", equalTo(null))
        .body("daemon.repositoryId", equalTo(repoId))
        .body("daemon.environment.PORT", equalTo("3000"))
        .body("daemon.observers[0].kind", equalTo("PATTERN"))
        .body("daemon.observers[0].pattern", equalTo("ERROR"))
        .body("daemon.observers[1].kind", equalTo("LOG_LEVEL"))
        .body("daemon.sources[0].path", equalTo("logs/app.log"))
        .body("daemon.sources[0].label", equalTo("app log"))
        .extract()
        .path("daemon.id");
  }

  @Test
  public void crudRoundTrip() {
    String repoId = createRepository();
    String id = create(repoId, "Dev server (crud)");

    given()
        .get("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("daemon.id", equalTo(id))
        .body("daemon.observers.size()", equalTo(2));

    given()
        .get("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(200)
        .body("entries.daemon.id", hasItem(id));

    given()
        .contentType(ContentType.JSON)
        .body(
            new UpdateRepositoryDaemonRequest(
                "Dev server (renamed)",
                null,
                null,
                "",
                null,
                RestartPolicy.NEVER,
                true, // autoStart — flip it back on to prove update threads the flag
                null,
                null,
                null,
                null,
                List.of(
                    new LogObserverInput(
                        LogObserverKind.PATTERN, "FATAL", DaemonEventSeverity.WARNING)),
                null))
        .put("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("daemon.name", equalTo("Dev server (renamed)"))
        .body("daemon.startScript", equalTo("npm run dev"))
        .body("daemon.readyPattern", equalTo(null))
        .body("daemon.webView.port", equalTo(5173)) // null webView = keep as-is
        .body("daemon.webView.entryPath", equalTo("greeting"))
        .body("daemon.restartPolicy", equalTo("NEVER"))
        .body("daemon.autoStart", equalTo(true))
        .body("daemon.observers.size()", equalTo(1))
        .body("daemon.observers[0].pattern", equalTo("FATAL"))
        .body("daemon.sources[0].path", equalTo("logs/app.log")); // null sources = keep as-is

    given()
        .delete("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("success", equalTo(true));

    given().get("/api/repositories/" + repoId + "/daemons/" + id).then().statusCode(404);
  }

  @Test
  public void webViewClearsWithPortZeroAndRejectsInvalidValues() {
    String repoId = createRepository();
    String id = create(repoId, "Dev server (web view)");

    // A present block replaces the paths wholesale (port carries over when omitted).
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("webView", Map.of("entryPath", "welcome", "basePath", "app")))
        .put("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("daemon.webView.port", equalTo(5173))
        .body("daemon.webView.entryPath", equalTo("welcome"))
        .body("daemon.webView.basePath", equalTo("app"));

    // ... including dropping a previously-set path that the new block omits.
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("webView", Map.of("port", 4200)))
        .put("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("daemon.webView.port", equalTo(4200))
        .body("daemon.webView.entryPath", equalTo(null))
        .body("daemon.webView.basePath", equalTo(null));

    // port 0 clears the whole block — the daemon is no longer web-viewable.
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("webView", Map.of("port", 0)))
        .put("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(200)
        .body("daemon.webView", equalTo(null));

    // Out-of-range ports and traversal paths are rejected on create and update.
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("webView", Map.of("port", 70000)))
        .put("/api/repositories/" + repoId + "/daemons/" + id)
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("name", "bad port", "startScript", "run", "webView", Map.of("port", 70000)))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(
            Map.of(
                "name",
                "bad entry",
                "startScript",
                "run",
                "webView",
                Map.of("port", 4200, "entryPath", "../escape")))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
  }

  @Test
  public void enforcesOwnershipAcrossRepositories() {
    String repoA = createRepository();
    String repoB = createRepository();
    String id = create(repoA, "Owned by A");

    // Another repository can neither read, edit nor delete it.
    given().get("/api/repositories/" + repoB + "/daemons/" + id).then().statusCode(404);
    given().delete("/api/repositories/" + repoB + "/daemons/" + id).then().statusCode(404);
    given()
        .get("/api/repositories/" + repoB + "/daemons")
        .then()
        .statusCode(200)
        .body("entries.size()", equalTo(0));
  }

  @Test
  public void rejectsAnInvalidReadyPatternRegex() {
    String repoId = createRepository();
    given()
        .contentType(ContentType.JSON)
        .body(
            new CreateRepositoryDaemonRequest(
                "Broken regex",
                null,
                "npm run dev",
                "([unclosed",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
  }

  @Test
  public void rejectsAPatternObserverWithoutAPattern() {
    String repoId = createRepository();
    given()
        .contentType(ContentType.JSON)
        .body(
            new CreateRepositoryDaemonRequest(
                "Observer without pattern",
                null,
                "npm run dev",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                List.of(new LogObserverInput(LogObserverKind.PATTERN, null, null)),
                null))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
  }

  @Test
  public void rejectsTraversalInLogSourcePaths() {
    String repoId = createRepository();
    for (String path : List.of("../outside.log", "/etc/passwd", ".git/config")) {
      given()
          .contentType(ContentType.JSON)
          .body(
              new CreateRepositoryDaemonRequest(
                  "Bad source",
                  null,
                  "npm run dev",
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  null,
                  List.of(new LogSourceInput(path, null))))
          .post("/api/repositories/" + repoId + "/daemons")
          .then()
          .statusCode(400);
    }
  }

  @Test
  public void validatesRequiredFields() {
    String repoId = createRepository();
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("name", "no script"))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("name", "x", "startScript", "run", "observers", List.of(Map.of())))
        .post("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(400);
  }
}
