package eu.wohlben.qits.domain.featureflow.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
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
public class FeatureFlowConfigurationControllerTest {

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ProjectService projectService;

  @Test
  public void testCreateAndGetAndListAndUpdateAndDelete() {
    // Create project
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Ctrl Project", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("project.id");

    // Create feature flow configuration under project
    String id =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController
                    .CreateProjectFeatureFlowConfigurationRequest("Ctrl Flow"))
            .when()
            .post("/api/projects/" + projectId + "/feature-flow-configurations")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowConfiguration.id", notNullValue())
            .body("featureFlowConfiguration.name", equalTo("Ctrl Flow"))
            .body("featureFlowConfiguration.projectId", equalTo(projectId))
            .extract()
            .path("featureFlowConfiguration.id");

    // Get
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-configurations/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowConfiguration.id", equalTo(id))
        .body("featureFlowConfiguration.name", equalTo("Ctrl Flow"));

    // List
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-configurations")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("entries.featureFlowConfiguration.id", hasItem(id));

    // Update
    given()
        .contentType(ContentType.JSON)
        .body(
            new FeatureFlowConfigurationController.UpdateFeatureFlowConfigurationRequest(
                "Updated Flow"))
        .when()
        .put("/api/feature-flow-configurations/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowConfiguration.name", equalTo("Updated Flow"));

    // Delete
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-configurations/" + id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("success", equalTo(true));

    // Get after delete should 404
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-configurations/" + id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testCreateValidationErrors() {
    // Create project
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(
                new eu.wohlben.qits.domain.project.api.ProjectController.CreateProjectRequest(
                    "Val Project", null))
            .when()
            .post("/api/projects")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
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
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void testUpdateNotFound() {
    given()
        .contentType(ContentType.JSON)
        .body(new FeatureFlowConfigurationController.UpdateFeatureFlowConfigurationRequest("Name"))
        .when()
        .put("/api/feature-flow-configurations/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testDeleteNotFound() {
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-configurations/non-existent")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }

  @Test
  public void testGetFullTreeSerialization() {
    var project = projectService.create("Tree Project", null);
    var config = featureFlowConfigurationService.createUnderProject(project.id, "End-to-End Flow");
    var phase = featureFlowPhaseService.create(config.id, "Development", "Dev phase", 0, null);
    var step = featureFlowPhaseStepService.create(phase.id, "Lint", 0);
    var action =
        actionConfigurationService.create(
            "Lint Frontend", "Runs eslint", "eslint .", "echo required");
    featureFlowPhaseActionService.create(
        step.id, action.id, ActionType.PREREQUISITE, 0, "lint-group");

    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-configurations/" + config.id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowConfiguration.id", equalTo(config.id))
        .body("featureFlowConfiguration.name", equalTo("End-to-End Flow"))
        .body("featureFlowConfiguration.phases.size()", equalTo(1))
        .body("featureFlowConfiguration.phases[0].id", equalTo(phase.id))
        .body("featureFlowConfiguration.phases[0].name", equalTo("Development"))
        .body("featureFlowConfiguration.phases[0].steps.size()", equalTo(1))
        .body("featureFlowConfiguration.phases[0].steps[0].id", equalTo(step.id))
        .body("featureFlowConfiguration.phases[0].steps[0].name", equalTo("Lint"))
        .body("featureFlowConfiguration.phases[0].steps[0].actions.size()", equalTo(1))
        .body(
            "featureFlowConfiguration.phases[0].steps[0].actions[0].actionConfiguration.id",
            equalTo(action.id))
        .body(
            "featureFlowConfiguration.phases[0].steps[0].actions[0].actionType",
            equalTo("PREREQUISITE"))
        .body(
            "featureFlowConfiguration.phases[0].steps[0].actions[0].parallelGroup",
            equalTo("lint-group"));
  }

  @Test
  public void testSubPhaseWithStepsAndActions() {
    var project = projectService.create("Sub Project", null);
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Sub-Phase Flow");
    var parent = featureFlowPhaseService.create(config.id, "Development", null, 0, null);
    var child = featureFlowPhaseService.create(config.id, "Work Package A", null, 0, parent.id);
    var step = featureFlowPhaseStepService.create(child.id, "Test", 0);
    var action = actionConfigurationService.create("Test WP", "Desc", "pytest", "echo required");
    featureFlowPhaseActionService.create(step.id, action.id, ActionType.QUALITY_GATE, 0, null);

    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-configurations/" + config.id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("featureFlowConfiguration.phases.size()", equalTo(1))
        .body("featureFlowConfiguration.phases[0].subPhases.size()", equalTo(1))
        .body("featureFlowConfiguration.phases[0].subPhases[0].id", equalTo(child.id))
        .body("featureFlowConfiguration.phases[0].subPhases[0].steps.size()", equalTo(1))
        .body("featureFlowConfiguration.phases[0].subPhases[0].steps[0].name", equalTo("Test"))
        .body("featureFlowConfiguration.phases[0].subPhases[0].steps[0].actions.size()", equalTo(1))
        .body(
            "featureFlowConfiguration.phases[0].subPhases[0].steps[0].actions[0].actionType",
            equalTo("QUALITY_GATE"));
  }

  @Test
  public void testCascadeDeletePhaseRemovesSubPhasesStepsAndActions() {
    var project = projectService.create("Cascade Project", null);
    var config = featureFlowConfigurationService.createUnderProject(project.id, "Cascade Flow");
    var phase = featureFlowPhaseService.create(config.id, "Dev", null, 0, null);
    var step = featureFlowPhaseStepService.create(phase.id, "Build", 0);
    var action = actionConfigurationService.create("Build", "Desc", "mvn build", "echo required");
    var link =
        featureFlowPhaseActionService.create(step.id, action.id, ActionType.PREREQUISITE, 0, null);

    // Add a sub-phase with its own step and action
    var child = featureFlowPhaseService.create(config.id, "Sub-Dev", null, 0, phase.id);
    var childStep = featureFlowPhaseStepService.create(child.id, "Lint", 0);
    var childAction = actionConfigurationService.create("Lint", "Desc", "eslint", "echo required");
    var childLink =
        featureFlowPhaseActionService.create(
            childStep.id, childAction.id, ActionType.PREREQUISITE, 0, null);

    // Delete the parent phase
    given()
        .contentType(ContentType.JSON)
        .when()
        .delete("/api/feature-flow-phases/" + phase.id)
        .then()
        .statusCode(Response.Status.OK.getStatusCode());

    // Parent phase should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phases/" + phase.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());

    // Parent step should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-steps/" + step.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());

    // Parent action link should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-actions/" + link.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());

    // Sub-phase should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phases/" + child.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());

    // Sub-phase step should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-steps/" + childStep.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());

    // Sub-phase action link should be gone
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/feature-flow-phase-actions/" + childLink.id)
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
