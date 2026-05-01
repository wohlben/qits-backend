package eu.wohlben.qits.domain.featureflow.api;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;

@QuarkusTest
public class ActionConfigurationControllerTest {

    @Test
    public void testCreateAndGetAndListAndUpdateAndDelete() {
        // Create
        given()
            .contentType(ContentType.JSON)
            .body(new ActionConfigurationController.CreateActionConfigurationRequest(
                "ctrl-test", "Ctrl Action", "Desc", "echo run", "echo required"
            ))
        .when()
            .post("/action-configurations")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("actionConfiguration.id", equalTo("ctrl-test"))
            .body("actionConfiguration.name", equalTo("Ctrl Action"))
            .body("actionConfiguration.description", equalTo("Desc"))
            .body("actionConfiguration.executeScript", equalTo("echo run"))
            .body("actionConfiguration.checkScript", equalTo("echo required"));

        // Get
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/action-configurations/ctrl-test")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("actionConfiguration.id", equalTo("ctrl-test"))
            .body("actionConfiguration.name", equalTo("Ctrl Action"));

        // List
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/action-configurations")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("entries.actionConfiguration.id", hasItem("ctrl-test"));

        // Update
        given()
            .contentType(ContentType.JSON)
            .body(new ActionConfigurationController.UpdateActionConfigurationRequest(
                "Updated Name", "Updated Desc", "echo updated", "echo suggested"
            ))
        .when()
            .put("/action-configurations/ctrl-test")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("actionConfiguration.name", equalTo("Updated Name"))
            .body("actionConfiguration.description", equalTo("Updated Desc"))
            .body("actionConfiguration.executeScript", equalTo("echo updated"))
            .body("actionConfiguration.checkScript", equalTo("echo suggested"));

        // Delete
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/action-configurations/ctrl-test")
        .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .body("success", equalTo(true));

        // Get after delete should 404
        given()
            .contentType(ContentType.JSON)
        .when()
            .get("/action-configurations/ctrl-test")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testCreateDuplicateId() {
        given()
            .contentType(ContentType.JSON)
            .body(new ActionConfigurationController.CreateActionConfigurationRequest(
                "dup-id", "First", null, "echo 1", "echo optional"
            ))
        .when()
            .post("/action-configurations")
        .then()
            .statusCode(Response.Status.OK.getStatusCode());

        given()
            .contentType(ContentType.JSON)
            .body(new ActionConfigurationController.CreateActionConfigurationRequest(
                "dup-id", "Second", null, "echo 2", "echo optional"
            ))
        .when()
            .post("/action-configurations")
        .then()
            .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
    }

    @Test
    public void testCreateValidationErrors() {
        given()
            .contentType(ContentType.JSON)
            .body(new ActionConfigurationController.CreateActionConfigurationRequest(
                "", "", null, "", ""
            ))
        .when()
            .post("/action-configurations")
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
            .body(new ActionConfigurationController.UpdateActionConfigurationRequest(
                "Name", null, "echo", "echo"
            ))
        .when()
            .put("/action-configurations/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }

    @Test
    public void testDeleteNotFound() {
        given()
            .contentType(ContentType.JSON)
        .when()
            .delete("/action-configurations/non-existent")
        .then()
            .statusCode(Response.Status.NOT_FOUND.getStatusCode());
    }
}
