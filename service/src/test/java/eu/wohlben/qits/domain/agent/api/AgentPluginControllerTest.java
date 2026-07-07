package eu.wohlben.qits.domain.agent.api;

import static io.restassured.RestAssured.given;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

/**
 * Wiring + validation tests for the agent-plugin endpoints. They assert the routes exist and that
 * the service's id guards reject bad input before it can reach a container — proving the endpoints
 * are wired without needing docker or the claude binary (mirrors {@code AgentControllerTest}).
 */
@QuarkusTest
public class AgentPluginControllerTest {

  @Test
  public void listRejectsANonUuidRepositoryId() {
    given()
        .contentType(ContentType.JSON)
        .when()
        .get("/api/repositories/not-a-uuid/workspaces/main/agent-plugins")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void installRejectsANonUuidRepositoryId() {
    given()
        .contentType(ContentType.JSON)
        .when()
        .post("/api/repositories/not-a-uuid/workspaces/main/agent-plugins/jdtls-lsp/install")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void installRejectsAMalformedPluginId() {
    // A syntactically valid repo id gets past the id guard, so the plugin-id guard is what rejects
    // here — an uppercase/at-qualified id is not a bare marketplace slug.
    given()
        .contentType(ContentType.JSON)
        .when()
        .post(
            "/api/repositories/00000000-0000-0000-0000-000000000000/workspaces/main"
                + "/agent-plugins/NotASlug/install")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }
}
