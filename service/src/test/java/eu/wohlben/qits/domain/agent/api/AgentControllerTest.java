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

@QuarkusTest
public class AgentControllerTest {

  @Test
  public void missingScopeIsRejected() {
    Map<String, Object> body = new HashMap<>();
    body.put("scope", null);
    given()
        .contentType(ContentType.JSON)
        .body(body)
        .when()
        .post("/api/repositories/some-repo/worktrees/wt/agents")
        .then()
        .statusCode(anyOf(equalTo(Response.Status.BAD_REQUEST.getStatusCode()), equalTo(422)));
  }

  @Test
  public void aNonUuidRepositoryIdIsRejected() {
    // Reaches the service, whose UUID guard rejects the repo id before it can be embedded in a
    // launch command. Proves the agent endpoint is wired without needing the claude binary.
    given()
        .contentType(ContentType.JSON)
        .body(Map.of("scope", "ACTIONS"))
        .when()
        .post("/api/repositories/not-a-uuid/worktrees/wt/agents")
        .then()
        .statusCode(Response.Status.BAD_REQUEST.getStatusCode());
  }
}
