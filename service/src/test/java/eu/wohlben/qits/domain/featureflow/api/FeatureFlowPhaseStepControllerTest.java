package eu.wohlben.qits.domain.featureflow.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class FeatureFlowPhaseStepControllerTest {

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject ProjectService projectService;

  private String createPhaseId() {
    var project = projectService.create("Step Project", null);
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Step Test Flow");
    var phase = featureFlowPhaseService.create(config.id, "Phase", null, 0, null);
    return phase.id;
  }

  @Test
  public void testCreateAndGetAndListAndUpdateAndDelete() {
    String phaseId = createPhaseId();

    // Create
    String id =
        given()
            .contentType(ContentType.JSON)
            .body(
                new FeatureFlowPhaseStepController.CreateFeatureFlowPhaseStepRequest(
                    phaseId, "Lint", 0))
            .when()
            .post("/api/feature-flow-phase-steps")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowPhaseStep.id", notNullValue())
            .body("featureFlowPhaseStep.name", equalTo("Lint"))
            .body("featureFlowPhaseStep.sortOrder", equalTo(0))
            .extract()
            .path("featureFlowPhaseStep.id");

    // Get
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-steps/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowPhaseStep.id", equalTo(id))
        .body("featureFlowPhaseStep.name", equalTo("Lint"));

    // List
    given()
        .contentType(ContentType.JSON)
        .queryParam("phaseId", phaseId)
        .when()
        .get("/api/feature-flow-phase-steps")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.featureFlowPhaseStep.id", hasItem(id));

    // Update
    given()
        .contentType(ContentType.JSON)
        .body(new FeatureFlowPhaseStepController.UpdateFeatureFlowPhaseStepRequest("Test", 1))
        .when()
        .put("/api/feature-flow-phase-steps/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowPhaseStep.name", equalTo("Test"))
        .body("featureFlowPhaseStep.sortOrder", equalTo(1));

    // Delete
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-phase-steps/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("success", equalTo(true));

    // Get after delete should 404
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-steps/" + id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testCreateValidationErrors() {
    given()
        .contentType(ContentType.JSON)
        .body(new FeatureFlowPhaseStepController.CreateFeatureFlowPhaseStepRequest("", "", 0))
        .when()
        .post("/api/feature-flow-phase-steps")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void testUpdateNotFound() {
    given()
        .contentType(ContentType.JSON)
        .body(new FeatureFlowPhaseStepController.UpdateFeatureFlowPhaseStepRequest("Name", 0))
        .when()
        .put("/api/feature-flow-phase-steps/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testDeleteNotFound() {
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-phase-steps/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
