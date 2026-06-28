package eu.wohlben.qits.validation;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(ValidationTest.TestProfile.class)
public class ValidationTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public ValidationTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  // --- Create validation ---

  @Test
  public void createProjectWithBlankNameReturns400() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest("", null))
        .when()
        .post("/api/projects")
        .then()
        .statusCode(anyOf(equalTo(400), equalTo(422)))
        .body("violations.message", hasItem("must not be blank"));
  }

  @Test
  public void createFeatureFlowConfigurationWithBlankNameReturns400() {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Val Project", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");

    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.project.api.ProjectController
                .CreateProjectFeatureFlowConfigurationRequest(""))
        .when()
        .post("/api/projects/" + projectId + "/feature-flow-configurations")
        .then()
        .statusCode(anyOf(equalTo(400), equalTo(422)))
        .body("violations.message", hasItem("must not be blank"));
  }

  @Test
  public void createActionConfigurationWithBlankScriptsReturns400() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController
                .CreateActionConfigurationRequest("name", null, "", "check", null, null, null))
        .when()
        .post("/api/action-configurations")
        .then()
        .statusCode(anyOf(equalTo(400), equalTo(422)))
        .body("violations.message", hasItem("must not be blank"));
  }

  // --- Update validation (@NotBlankIfPresent) ---

  @Test
  public void updateProjectWithBlankNameReturns400() {
    // seed
    String id =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Original", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");

    // update with blank name
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.project.api.ProjectController.UpdateProjectRequest("", null))
        .when()
        .put("/api/projects/" + id)
        .then()
        .statusCode(anyOf(equalTo(400), equalTo(422)))
        .body("violations.message", hasItem("must not be blank"));
  }

  @Test
  public void updateFeatureFlowPhaseWithBlankNameReturns400() {
    // seed project
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Original", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");

    // seed config
    String configId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController
                    .CreateProjectFeatureFlowConfigurationRequest("config-name"))
            .when()
            .post("/api/projects/" + projectId + "/feature-flow-configurations")
            .then()
            .statusCode(200)
            .extract()
            .path("featureFlowConfiguration.id");

    // seed phase
    var phaseId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.featureflow.api.FeatureFlowPhaseController
                    .CreateFeatureFlowPhaseRequest(configId, "phase-name", null, 0, null))
            .when()
            .post("/api/feature-flow-phases")
            .then()
            .statusCode(200)
            .extract()
            .path("featureFlowPhase.id");

    // update with blank name
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.featureflow.api.FeatureFlowPhaseController
                .UpdateFeatureFlowPhaseRequest("", null, null, null))
        .when()
        .put("/api/feature-flow-phases/" + phaseId)
        .then()
        .statusCode(anyOf(equalTo(400), equalTo(422)))
        .body("violations.message", hasItem("must not be blank"));
  }

  // --- Partial update acceptance (null fields are fine) ---

  @Test
  public void updateProjectWithNullNameIsAllowed() {
    // seed
    String id =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Original", "desc"))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");

    // partial update — only description
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.project.api.ProjectController.UpdateProjectRequest(
                null, "Updated Desc"))
        .when()
        .put("/api/projects/" + id)
        .then()
        .statusCode(200)
        .body("project.description", equalTo("Updated Desc"))
        .body("project.name", equalTo("Original"));
  }

  @Test
  public void updateActionConfigurationWithNullFieldsIsAllowed() {
    // seed
    String id =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController
                    .CreateActionConfigurationRequest(
                    "Original Name", "desc", "exec", "check", null, null, null))
            .when()
            .post("/api/action-configurations")
            .then()
            .statusCode(200)
            .extract()
            .path("actionConfiguration.id");

    // partial update — only description
    given()
        .contentType(ContentType.JSON)
        .body(
            new eu.wohlben.qits.domain.featureflow.api.ActionConfigurationController
                .UpdateActionConfigurationRequest(
                null, "Updated Desc", null, null, null, null, null))
        .when()
        .put("/api/action-configurations/" + id)
        .then()
        .statusCode(200)
        .body("actionConfiguration.description", equalTo("Updated Desc"))
        .body("actionConfiguration.name", equalTo("Original Name"));
  }
}
