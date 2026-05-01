package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

@QuarkusTest
public class FeatureFlowPhaseControllerTest {

    @Inject
    FeatureFlowConfigurationService featureFlowConfigurationService;

    @Test
    public void testCreateAndGetAndListAndUpdateAndDelete() {
        var config = featureFlowConfigurationService.create("Ctrl Flow");

        // Create
        String id = given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowPhaseController.CreateFeatureFlowPhaseRequest(
                config.id, "Refining", "Desc", 0, null
            ))
        .when()
            .post("/api/feature-flow-phases")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowPhase.id", notNullValue())
            .body("featureFlowPhase.name", equalTo("Refining"))
            .body("featureFlowPhase.description", equalTo("Desc"))
            .body("featureFlowPhase.orderIndex", equalTo(0))
            .body("featureFlowPhase.featureFlowConfigurationId", equalTo(config.id))
            .extract()
            .path("featureFlowPhase.id");

        // Get
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/api/feature-flow-phases/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowPhase.id", equalTo(id))
            .body("featureFlowPhase.name", equalTo("Refining"));

        // List
        given()
            .contentType(ContentType.JSON)
            .queryParam("featureFlowConfigurationId", config.id)
        .when()
            .get("/api/feature-flow-phases")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("entries.featureFlowPhase.id", hasItem(id));

        // Update
        given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowPhaseController.UpdateFeatureFlowPhaseRequest(
                "Updated", "New desc", 1, null
            ))
        .when()
            .put("/api/feature-flow-phases/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowPhase.name", equalTo("Updated"))
            .body("featureFlowPhase.description", equalTo("New desc"))
            .body("featureFlowPhase.orderIndex", equalTo(1));

        // Delete
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/api/feature-flow-phases/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("success", equalTo(true));

        // Get after delete should 404
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/api/feature-flow-phases/" + id)
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testCreateValidationErrors() {
        given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowPhaseController.CreateFeatureFlowPhaseRequest(
                "", "", null, 0, null
            ))
        .when()
            .post("/api/feature-flow-phases")
        .then()
            .statusCode(anyOf(
                equalTo(Response.Status.BAD_REQUEST.getStatusCode()),
                equalTo(422)
            ));
    }

    @Test
    public void testUpdateNotFound() {
        given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowPhaseController.UpdateFeatureFlowPhaseRequest(
                "Name", null, 0, null
            ))
        .when()
            .put("/api/feature-flow-phases/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testDeleteNotFound() {
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/api/feature-flow-phases/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }
}
