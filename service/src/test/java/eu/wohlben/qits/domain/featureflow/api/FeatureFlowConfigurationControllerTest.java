package eu.wohlben.qits.domain.featureflow.api;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

@QuarkusTest
public class FeatureFlowConfigurationControllerTest {

    @Test
    public void testCreateAndGetAndListAndUpdateAndDelete() {
        // Create
        String id = given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowConfigurationController.CreateFeatureFlowConfigurationRequest("Ctrl Flow"))
        .when()
            .post("/feature-flow-configurations")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowConfiguration.id", notNullValue())
            .body("featureFlowConfiguration.name", equalTo("Ctrl Flow"))
            .extract()
            .path("featureFlowConfiguration.id");

        // Get
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/feature-flow-configurations/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowConfiguration.id", equalTo(id))
            .body("featureFlowConfiguration.name", equalTo("Ctrl Flow"));

        // List
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/feature-flow-configurations")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("entries.featureFlowConfiguration.id", hasItem(id));

        // Update
        given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowConfigurationController.UpdateFeatureFlowConfigurationRequest("Updated Flow"))
        .when()
            .put("/feature-flow-configurations/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("featureFlowConfiguration.name", equalTo("Updated Flow"));

        // Delete
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/feature-flow-configurations/" + id)
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("success", equalTo(true));

        // Get after delete should 404
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/feature-flow-configurations/" + id)
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testCreateValidationErrors() {
        given()
            .contentType(ContentType.JSON)
            .body(new FeatureFlowConfigurationController.CreateFeatureFlowConfigurationRequest(""))
        .when()
            .post("/feature-flow-configurations")
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
            .body(new FeatureFlowConfigurationController.UpdateFeatureFlowConfigurationRequest("Name"))
        .when()
            .put("/feature-flow-configurations/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testDeleteNotFound() {
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/feature-flow-configurations/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }
}
