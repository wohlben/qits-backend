package eu.wohlben.qits.domain.agent.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Validation-level tests only — every request here fails before a refinement process could spawn,
 * so the suite never needs the claude binary (mirrors {@link AgentControllerTest}).
 */
@QuarkusTest
public class PromptRefinementControllerTest {

  @Test
  public void missingTranscriptIsRejected() {
    Map<String, Object> body = new HashMap<>();
    body.put("transcript", null);
    given()
        .contentType(ContentType.JSON)
        .body(body)
        .when()
        .post("/api/repositories/some-repo/workspaces/wt/prompt-refinements")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void blankTranscriptIsRejected() {
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("transcript", "   "))
        .when()
        .post("/api/repositories/some-repo/workspaces/wt/prompt-refinements")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void anInvalidWorkspaceIdIsRejected() {
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("transcript", "add a healthcheck"))
        .when()
        .post("/api/repositories/some-repo/workspaces/..traversal/prompt-refinements")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }

  @Test
  public void anUnknownWorkspaceIsNotFound() {
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("transcript", "add a healthcheck"))
        .when()
        .post("/api/repositories/no-such-repo/workspaces/no-such-wt/prompt-refinements")
        .then()
        .statusCode(Response.Status.NOT_FOUND.getStatusCode());
  }
}
