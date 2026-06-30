package eu.wohlben.qits.domain.command.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

import eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController.CreateActionConfigurationRequest;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRepositoryRequest;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest;
import eu.wohlben.qits.domain.repository.api.WorktreeController.CreateWorktreeRequest;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
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

  /** Clones the fixture and forks a {@code cmd-wt} worktree off master to launch commands in. */
  private String repoWithWorktree() {
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
            .body(new CreateProjectRepositoryRequest(fixtureUrl, null))
            .when()
            .post("/api/projects/" + projectId + "/repositories")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("repository.id");

    given()
        .contentType(ContentType.JSON)
        .body(new CreateWorktreeRequest("cmd-wt", "master", "cmd-wt"))
        .when()
        .post("/api/repositories/" + repoId + "/worktrees")
        .then()
        .statusCode(Response.Status.OK.getStatusCode());

    return repoId;
  }

  private String createSleepAction() {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateActionConfigurationRequest(
                "sleep-action", null, "sleep 30", null, true, ActionVariant.SHELL, null))
        .when()
        .post("/api/action-configurations")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("actionConfiguration.id");
  }

  @Test
  public void launchListGetAndTerminate() {
    String repoId = repoWithWorktree();
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
            .body("command.worktreeId", equalTo("cmd-wt"))
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
