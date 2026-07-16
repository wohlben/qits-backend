package eu.wohlben.qits.domain.command.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

import eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController.CreateActionConfigurationRequest;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRepositoryRequest;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest;
import eu.wohlben.qits.domain.repository.api.WorkspaceController.CreateWorkspaceRequest;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(CommandControllerTest.TestProfile.class)
public class CommandControllerTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-command-ctl-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public CommandControllerTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  /** Clones the fixture and forks a {@code cmd-wt} workspace off master to launch commands in. */
  private String repoWithWorkspace() {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(new CreateProjectRequest("Command Project", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("project.id");

    String repoId =
        given()
            .contentType(ContentType.JSON)
            .body(new CreateProjectRepositoryRequest(fixtureUrl, null, null))
            .when()
            .post("/api/projects/" + projectId + "/repositories")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("repository.id");

    given()
        .contentType(ContentType.JSON)
        .body(new CreateWorkspaceRequest("cmd-wt", "master", "cmd-wt", null))
        .when()
        .post("/api/repositories/" + repoId + "/workspaces")
        .then()
        .statusCode(Response.Status.OK.getStatusCode());

    return repoId;
  }

  private String createSleepAction() {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateActionConfigurationRequest(
                "sleep-action", null, "sleep 30", null, true, null))
        .when()
        .post("/api/action-configurations")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("actionConfiguration.id");
  }

  @Test
  public void launchListGetAndTerminate() {
    String repoId = repoWithWorkspace();
    String actionId = createSleepAction();

    String commandId =
        given()
            .contentType(ContentType.JSON)
            .body(new CommandController.LaunchCommandRequest(repoId, "cmd-wt", actionId))
            .when()
            .post("/api/commands")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("command.status", equalTo("RUNNING"))
            .body("command.workspaceId", equalTo("cmd-wt"))
            .body("command.branch", equalTo("cmd-wt"))
            .body("command.actionName", equalTo("sleep-action"))
            .body("command.id", not(emptyOrNullString()))
            .extract()
            .path("command.id");

    // It appears in the repository-filtered list while running.
    given()
        .when()
        .get("/api/commands?repoId=" + repoId)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.command.id", hasItem(commandId));

    // It can be fetched directly.
    given()
        .when()
        .get("/api/commands/" + commandId)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.id", equalTo(commandId))
        .body("command.status", equalTo("RUNNING"));

    // Terminating it flips the status.
    given()
        .contentType(ContentType.JSON)
        .when()
        .post("/api/commands/" + commandId + "/terminate")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("command.status", equalTo("TERMINATED"));
  }

  private String createEchoAction() {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateActionConfigurationRequest(
                "echo-action", null, "echo hello-http", null, false, null))
        .when()
        .post("/api/action-configurations")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("actionConfiguration.id");
  }

  @Test
  public void capturesAndServesTheLog() throws Exception {
    String repoId = repoWithWorkspace();
    String actionId = createEchoAction();

    String commandId =
        given()
            .contentType(ContentType.JSON)
            .body(new CommandController.LaunchCommandRequest(repoId, "cmd-wt", actionId))
            .when()
            .post("/api/commands")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("command.id");

    // The echo exits immediately and its log is written asynchronously; poll for it to flush.
    boolean captured = false;
    for (int i = 0; i < 30 && !captured; i++) {
      List<String> contents =
          given()
              .when()
              .get("/api/commands/" + commandId + "/log")
              .then()
              .statusCode(Response.Status.OK.getStatusCode())
              .extract()
              .path("lines.content");
      captured = contents != null && contents.stream().anyMatch(c -> c.contains("hello-http"));
      if (!captured) {
        Thread.sleep(100);
      }
    }
    org.junit.jupiter.api.Assertions.assertTrue(captured, "the echoed output should be in the log");
  }

  @Test
  public void listFiltersByWorkspaceAndComposesWithStatus() {
    String repoId = repoWithWorkspace();
    given()
        .contentType(ContentType.JSON)
        .body(new CreateWorkspaceRequest("other-wt", "master", "other-wt", null))
        .when()
        .post("/api/repositories/" + repoId + "/workspaces")
        .then()
        .statusCode(Response.Status.OK.getStatusCode());

    String echoId =
        given()
            .contentType(ContentType.JSON)
            .body(new CommandController.LaunchCommandRequest(repoId, "cmd-wt", createEchoAction()))
            .when()
            .post("/api/commands")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("command.id");
    String sleepId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new CommandController.LaunchCommandRequest(repoId, "other-wt", createSleepAction()))
            .when()
            .post("/api/commands")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("command.id");

    // The workspace filter only returns that workspace's commands.
    given()
        .when()
        .get("/api/commands?repoId=" + repoId + "&workspaceId=cmd-wt")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.command.id", hasItem(echoId))
        .body("entries.command.id", not(hasItem(sleepId)))
        .body("entries.command.workspaceId", everyItem(equalTo("cmd-wt")));

    // It composes with the status filter: the sleeper is RUNNING, so it survives that filter...
    given()
        .when()
        .get("/api/commands?repoId=" + repoId + "&workspaceId=other-wt&status=RUNNING")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.command.id", hasItem(sleepId));

    // ...but not the EXITED one.
    given()
        .when()
        .get("/api/commands?repoId=" + repoId + "&workspaceId=other-wt&status=EXITED")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.command.id", not(hasItem(sleepId)));

    given()
        .contentType(ContentType.JSON)
        .when()
        .post("/api/commands/" + sleepId + "/terminate")
        .then()
        .statusCode(Response.Status.OK.getStatusCode());
  }

  @Test
  public void workspaceFilterWithoutRepoIs400() {
    given()
        .when()
        .get("/api/commands?workspaceId=cmd-wt")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void launchRejectsBlankFields() {
    given()
        .contentType(ContentType.JSON)
        .body(new CommandController.LaunchCommandRequest("", "", ""))
        .when()
        .post("/api/commands")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void getUnknownCommandIs404() {
    given()
        .when()
        .get("/api/commands/does-not-exist")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
