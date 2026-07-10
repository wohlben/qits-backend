package eu.wohlben.qits.domain.daemon.mcp;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.project.api.ProjectController;
import eu.wohlben.qits.domain.repository.mcp.ProjectScope;
import io.quarkiverse.mcp.server.ToolResponse;
import io.quarkiverse.mcp.server.test.McpAssured;
import io.quarkiverse.mcp.server.test.McpAssured.McpStreamableTestClient;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Verifies daemon management on the "repository" MCP server: a session scoped to a project can
 * define, edit, run and delete a repository's daemons — daemons' only scope — and cannot reach a
 * repository outside its project.
 */
@QuarkusTest
@TestProfile(DaemonMcpToolsTest.TestProfile.class)
public class DaemonMcpToolsTest {

  /** Isolate cloned repos in a temp dir, plus test-speed supervisor timing for start/stop. */
  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-daemon-mcp-test-repos");
        return Map.of(
            "qits.repositories.data-dir", tempDir.toString(),
            "qits.daemons.ready-grace-ms", "300",
            "qits.daemons.stop-grace-ms", "1000");
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public DaemonMcpToolsTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private String createProject(String name) {
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRequest(name, null))
        .post("/api/projects")
        .then()
        .statusCode(200)
        .extract()
        .path("project.id");
  }

  private String createRepository(String projectId) {
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRepositoryRequest(fixtureUrl, null))
        .post("/api/projects/" + projectId + "/repositories")
        .then()
        .statusCode(200)
        .extract()
        .path("repository.id");
  }

  private String createWorkspace(String repoId, String workspaceId) {
    return given()
        .contentType(ContentType.JSON)
        .body(Map.of("id", workspaceId, "parent", "master"))
        .post("/api/repositories/" + repoId + "/workspaces")
        .then()
        .statusCode(200)
        .extract()
        .path("workspace.workspaceId");
  }

  private static String text(ToolResponse response) {
    return response.content().stream()
        .map(c -> c.asText().text())
        .collect(Collectors.joining("\n"));
  }

  private McpStreamableTestClient client(String projectId) {
    return McpAssured.newStreamableClient()
        .setMcpPath("/mcp/repository")
        .setAdditionalHeaders(
            msg -> {
              io.vertx.core.MultiMap headers = io.vertx.core.MultiMap.caseInsensitiveMultiMap();
              if (projectId != null) {
                headers.add(ProjectScope.PROJECT_HEADER, projectId);
              }
              return headers;
            })
        .build()
        .connect();
  }

  @Test
  public void managesADaemonThroughItsFullLifecycle() {
    String project = createProject("Daemon Mgmt");
    String repoId = createRepository(project);
    var client = client(project);

    // Define — with structured observers and file log sources.
    final String[] daemonId = new String[1];
    client
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId",
                repoId,
                "name",
                "Dev server",
                "startScript",
                "npm run dev",
                "readyPattern",
                "Listening on.*:3000",
                "restartPolicy",
                "always",
                "autoStart",
                false,
                "environment",
                Map.of("PORT", "3000"),
                "observers",
                List.of(
                    Map.of("kind", "PATTERN", "pattern", "ERROR", "severity", "ERROR"),
                    Map.of("kind", "LOG_LEVEL")),
                "sources",
                List.of(Map.of("path", "logs/app.log", "label", "app log"))),
            response -> {
              assertFalse(response.isError(), "create should succeed: " + text(response));
              String text = text(response);
              assertTrue(text.contains("Dev server"), text);
              assertTrue(text.contains("ALWAYS"), "restart policy parsed: " + text);
              assertTrue(text.contains("logs/app.log"), "sources round-trip: " + text);
            })
        .thenAssertResults();

    // The id, read back over REST (the tool response text may serialize the DTO more than once).
    daemonId[0] =
        given()
            .get("/api/repositories/" + repoId + "/daemons")
            .then()
            .statusCode(200)
            .body("entries[0].daemon.autoStart", org.hamcrest.Matchers.equalTo(false))
            .extract()
            .path("entries[0].daemon.id");

    // One chain per dependent call — calls within a single when() chain run concurrently, so
    // update/delete would race each other (and need the id when their arguments are built).
    client
        .when()
        .toolsCall(
            "listDaemons",
            Map.of("repoId", repoId),
            response -> {
              assertFalse(response.isError());
              assertTrue(text(response).contains("Dev server"), text(response));
            })
        .thenAssertResults();
    client
        .when()
        .toolsCall(
            "updateDaemon",
            Map.of(
                "repoId",
                repoId,
                "daemonId",
                daemonId[0],
                "name",
                "Dev server (renamed)",
                "autoStart",
                true),
            response -> {
              assertFalse(response.isError(), "update should succeed: " + text(response));
              String text = text(response);
              assertTrue(text.contains("Dev server (renamed)"), text);
              assertTrue(
                  text.contains("npm run dev"), "omitted fields must be kept as-is: " + text);
            })
        .thenAssertResults();

    // The autoStart toggle (false on create -> true on update) round-trips through the tool.
    given()
        .get("/api/repositories/" + repoId + "/daemons/" + daemonId[0])
        .then()
        .statusCode(200)
        .body("daemon.autoStart", org.hamcrest.Matchers.equalTo(true));
    client
        .when()
        .toolsCall(
            "deleteDaemon",
            Map.of("repoId", repoId, "daemonId", daemonId[0]),
            response -> assertFalse(response.isError(), text(response)))
        .thenAssertResults();
    client
        .when()
        .toolsCall(
            "listDaemons",
            Map.of("repoId", repoId),
            response -> {
              assertFalse(response.isError());
              assertFalse(text(response).contains("Dev server"), "deleted: " + text(response));
            })
        .thenAssertResults();
  }

  @Test
  public void definesHealthChecksAndReadsLiveHealthPerWorkspace() {
    String project = createProject("Daemon Health");
    String repoId = createRepository(project);
    createWorkspace(repoId, "work");
    var client = client(project);

    // Define with structured healthChecks — one per kind, string kinds parsed like observers'.
    client
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId",
                repoId,
                "name",
                "Checked server",
                "startScript",
                "npm run dev",
                "healthChecks",
                List.of(
                    Map.of("name", "Quarkus", "kind", "COMMAND", "command", "curl -fsS x"),
                    Map.of("name", "Angular", "kind", "http", "port", 4200, "path", "/"),
                    Map.of("name", "Postgres", "kind", "TCP", "port", 5432))),
            response -> {
              assertFalse(response.isError(), "create should succeed: " + text(response));
              String text = text(response);
              assertTrue(text.contains("Quarkus"), "checks round-trip: " + text);
              assertTrue(text.contains("HTTP"), "lower-case kind parsed: " + text);
            })
        .thenAssertResults();

    // The definition round-trips over REST in declaration order...
    given()
        .get("/api/repositories/" + repoId + "/daemons")
        .then()
        .statusCode(200)
        .body(
            "entries[0].daemon.healthChecks.name",
            org.hamcrest.Matchers.contains("Quarkus", "Angular", "Postgres"));

    // ...and listWorkspaceDaemons reports live health — all UNKNOWN for a never-started daemon,
    // one entry per declared check.
    client
        .when()
        .toolsCall(
            "listWorkspaceDaemons",
            Map.of("repoId", repoId, "workspaceId", "work"),
            response -> {
              assertFalse(response.isError(), text(response));
              String text = text(response);
              assertTrue(text.contains("\"health\""), "live health surfaced: " + text);
              assertTrue(text.contains("UNKNOWN"), "unprobed checks read UNKNOWN: " + text);
            })
        .thenAssertResults();

    // A bad kind fails with a readable tool error, not a Jackson stack.
    client
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId",
                repoId,
                "name",
                "Bad check",
                "startScript",
                "npm run dev",
                "healthChecks",
                List.of(Map.of("name", "nope", "kind", "HTTPS", "port", 443))),
            response -> {
              assertTrue(response.isError(), "invalid kind must fail");
              assertTrue(
                  text(response).contains("HTTP, TCP, COMMAND"),
                  "readable allowed-values hint: " + text(response));
            })
        .thenAssertResults();
  }

  @Test
  public void configuresTheWebViewThroughFlatArgs() {
    String project = createProject("Daemon WebView");
    String repoId = createRepository(project);
    var client = client(project);

    // Define with the flat web-view args: port + entry path (normalized slash-less).
    client
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId", repoId,
                "name", "Frontend dev server",
                "startScript", "pnpm start",
                "webViewPort", 4200,
                "webViewEntryPath", "/greeting/"),
            response -> assertFalse(response.isError(), text(response)))
        .thenAssertResults();

    String daemonId =
        given()
            .get("/api/repositories/" + repoId + "/daemons")
            .then()
            .statusCode(200)
            .body("entries[0].daemon.webView.port", org.hamcrest.Matchers.equalTo(4200))
            .body("entries[0].daemon.webView.entryPath", org.hamcrest.Matchers.equalTo("greeting"))
            .extract()
            .path("entries[0].daemon.id");

    // Per-field edit: a new entry path keeps the port.
    client
        .when()
        .toolsCall(
            "updateDaemon",
            Map.of("repoId", repoId, "daemonId", daemonId, "webViewEntryPath", "welcome"),
            response -> {
              assertFalse(response.isError(), text(response));
              assertTrue(text(response).contains("welcome"), text(response));
              assertTrue(text(response).contains("4200"), "port kept: " + text(response));
            })
        .thenAssertResults();

    // 0 clears the whole web-view config.
    client
        .when()
        .toolsCall(
            "updateDaemon",
            Map.of("repoId", repoId, "daemonId", daemonId, "webViewPort", 0),
            response -> {
              assertFalse(response.isError(), text(response));
              assertFalse(text(response).contains("4200"), "cleared config: " + text(response));
            })
        .thenAssertResults();

    given()
        .get("/api/repositories/" + repoId + "/daemons/" + daemonId)
        .then()
        .statusCode(200)
        .body("daemon.webView", org.hamcrest.Matchers.nullValue());
  }

  @Test
  public void startsAndStopsADaemonInAWorkspace() {
    String project = createProject("Daemon Run");
    String repoId = createRepository(project);
    String workspaceId = createWorkspace(repoId, "daemon-wt");
    var client = client(project);

    final String[] daemonId = new String[1];
    client
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId", repoId,
                "name", "Sleeper",
                "startScript", "sleep 300",
                "restartPolicy", "NEVER"),
            response -> assertFalse(response.isError(), text(response)))
        .thenAssertResults();

    daemonId[0] =
        given()
            .get("/api/repositories/" + repoId + "/daemons")
            .then()
            .statusCode(200)
            .extract()
            .path("entries[0].daemon.id");

    // One chain per call — calls within a single when() chain run concurrently.
    client
        .when()
        .toolsCall(
            "startDaemon",
            Map.of("repoId", repoId, "workspaceId", workspaceId, "daemonId", daemonId[0]),
            response -> {
              assertFalse(response.isError(), "start should succeed: " + text(response));
              assertTrue(text(response).contains("STARTING"), text(response));
            })
        .thenAssertResults();
    client
        .when()
        .toolsCall(
            "listWorkspaceDaemons",
            Map.of("repoId", repoId, "workspaceId", workspaceId),
            response -> {
              assertFalse(response.isError());
              String text = text(response);
              assertTrue(text.contains("Sleeper"), text);
              assertTrue(
                  text.contains("STARTING") || text.contains("READY"),
                  "instance state visible: " + text);
            })
        .thenAssertResults();
    client
        .when()
        .toolsCall(
            "stopDaemon",
            Map.of("repoId", repoId, "workspaceId", workspaceId, "daemonId", daemonId[0]),
            response -> assertFalse(response.isError(), "stop should succeed: " + text(response)))
        .thenAssertResults();
  }

  @Test
  public void refusesRepositoriesOutsideTheScopedProject() {
    String projectA = createProject("Daemon A");
    String repoInA = createRepository(projectA);
    String projectB = createProject("Daemon B");

    client(projectB)
        .when()
        .toolsCall(
            "listDaemons",
            Map.of("repoId", repoInA),
            response -> {
              assertTrue(response.isError(), "cross-project access must be refused");
              assertTrue(text(response).contains("not found in this project"), text(response));
            })
        .thenAssertResults();
  }

  @Test
  public void reportsAReadableErrorForAnInvalidRestartPolicy() {
    String project = createProject("Daemon Validation");
    String repoId = createRepository(project);

    client(project)
        .when()
        .toolsCall(
            "createDaemon",
            Map.of(
                "repoId", repoId,
                "name", "Bad policy",
                "startScript", "sleep 1",
                "restartPolicy", "SOMETIMES"),
            response -> {
              assertTrue(response.isError(), "invalid restartPolicy must be a tool error");
              assertTrue(text(response).contains("NEVER, ON_FAILURE, ALWAYS"), text(response));
            })
        .thenAssertResults();
  }
}
