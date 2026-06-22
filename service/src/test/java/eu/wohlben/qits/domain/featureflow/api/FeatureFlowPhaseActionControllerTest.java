package eu.wohlben.qits.domain.featureflow.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseStepService;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class FeatureFlowPhaseActionControllerTest {

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ProjectService projectService;

  private String createStepId() {
    var project = projectService.create("Action Project", null);
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Action Test Flow");
    var phase = featureFlowPhaseService.create(config.id, "Phase", null, 0, null);
    var step = featureFlowPhaseStepService.create(phase.id, "Build", 0);
    return step.id;
  }

  private String createActionId(String suffix) {
    return actionConfigurationService.create("Action " + suffix, "Desc", "echo exec", "echo check")
        .id;
  }

  @Test
  public void testCreateAndGetAndListAndUpdateAndDelete() {
    String stepId = createStepId();
    String actionId = createActionId("act-ctrl-1");

    // Create
    String linkId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new FeatureFlowPhaseActionController.CreateFeatureFlowPhaseActionRequest(
                    stepId, actionId, ActionType.PREREQUISITE, 0, "group-a"))
            .when()
            .post("/api/feature-flow-phase-actions")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowPhaseAction.id", notNullValue())
            .body("featureFlowPhaseAction.stepId", equalTo(stepId))
            .body("featureFlowPhaseAction.actionConfiguration.id", equalTo(actionId))
            .body("featureFlowPhaseAction.actionType", equalTo("PREREQUISITE"))
            .body("featureFlowPhaseAction.sortOrder", equalTo(0))
            .body("featureFlowPhaseAction.parallelGroup", equalTo("group-a"))
            .extract()
            .path("featureFlowPhaseAction.id");

    // Get
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-actions/" + linkId)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowPhaseAction.id", equalTo(linkId))
        .body("featureFlowPhaseAction.actionType", equalTo("PREREQUISITE"));

    // List
    given()
        .contentType(ContentType.JSON)
        .queryParam("stepId", stepId)
        .when()
        .get("/api/feature-flow-phase-actions")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.featureFlowPhaseAction.id", hasItem(linkId));

    // Update
    given()
        .contentType(ContentType.JSON)
        .body(
            new FeatureFlowPhaseActionController.UpdateFeatureFlowPhaseActionRequest(
                ActionType.QUALITY_GATE, 5, "group-b"))
        .when()
        .put("/api/feature-flow-phase-actions/" + linkId)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowPhaseAction.actionType", equalTo("QUALITY_GATE"))
        .body("featureFlowPhaseAction.sortOrder", equalTo(5))
        .body("featureFlowPhaseAction.parallelGroup", equalTo("group-b"));

    // Delete
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-phase-actions/" + linkId)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("success", equalTo(true));

    // Get after delete should 404
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-actions/" + linkId)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testCreateValidationErrors() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new FeatureFlowPhaseActionController.CreateFeatureFlowPhaseActionRequest(
                "", "", null, 0, null))
        .when()
        .post("/api/feature-flow-phase-actions")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void testUpdateNotFound() {
    given()
        .contentType(ContentType.JSON)
        .body(
            new FeatureFlowPhaseActionController.UpdateFeatureFlowPhaseActionRequest(
                ActionType.QUALITY_GATE, 0, null))
        .when()
        .put("/api/feature-flow-phase-actions/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testDeleteNotFound() {
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-phase-actions/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
