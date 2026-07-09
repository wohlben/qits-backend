package eu.wohlben.qits.domain.featureflow.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController.CreateActionConfigurationRequest;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRepositoryRequest;
import eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The effective-actions read endpoint: the merged global + repository-scoped set. */
@QuarkusTest
@TestProfile(RepositoryActionsControllerTest.TestProfile.class)
public class RepositoryActionsControllerTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-repo-actions-ctl-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  // Repository-scoped actions have no REST CRUD (deliberately deferred); create them through the
  // domain service, the same seam the MCP tools use.
  @Inject ActionConfigurationService actionConfigurationService;

  private final String fixtureUrl;

  public RepositoryActionsControllerTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private String createRepo(String projectName) {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(new CreateProjectRequest(projectName, null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("project.id");

    return given()
        .contentType(ContentType.JSON)
        .body(new CreateProjectRepositoryRequest(fixtureUrl, null))
        .when()
        .post("/api/projects/" + projectId + "/repositories")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("repository.id");
  }

  @Test
  public void returnsGlobalAndOwnRepositoryActionsWithScopes() {
    String repoId = createRepo("Effective Actions Project");
    String otherRepoId = createRepo("Other Actions Project");

    String globalId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new CreateActionConfigurationRequest(
                    "effective-global", null, "echo global", null, false, null))
            .when()
            .post("/api/action-configurations")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("actionConfiguration.id");

    String ownId =
        actionConfigurationService.createForRepository(
                repoId, "effective-own", null, "echo own", null, true, null)
            .id;
    String foreignId =
        actionConfigurationService.createForRepository(
                otherRepoId, "effective-foreign", null, "echo foreign", null, false, null)
            .id;

    given()
        .when()
        .get("/api/repositories/" + repoId + "/actions")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.action.id", hasItem(globalId))
        .body("entries.action.id", hasItem(ownId))
        .body("entries.action.id", not(hasItem(foreignId)))
        .body("entries.action.find { it.id == '" + globalId + "' }.scope", equalTo("GLOBAL"))
        .body("entries.action.find { it.id == '" + ownId + "' }.scope", equalTo("REPOSITORY"))
        .body("entries.action.find { it.id == '" + ownId + "' }.repositoryId", equalTo(repoId))
        .body("entries.action.find { it.id == '" + ownId + "' }.interactive", equalTo(true));
  }

  @Test
  public void unknownRepositoryIs404() {
    given()
        .when()
        .get("/api/repositories/does-not-exist/actions")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
