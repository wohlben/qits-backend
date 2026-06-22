package eu.wohlben.qits.mutiny.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class ContextPropagationControllerTest {

  @Test
  public void testRequestScopedContextPropagatesThroughUniDelay() {
    given()
        .contentType(ContentType.JSON)
        .header("X-Trace-Id", "trace-123")
        .when()
        .get("/api/context/trace")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("traceId", equalTo("trace-123"))
        .body("source", equalTo("async"));
  }

  @Test
  public void testRequestScopedContextPropagatesThroughUniChain() {
    given()
        .contentType(ContentType.JSON)
        .header("X-Trace-Id", "trace-456")
        .when()
        .post("/api/context/chain")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .body("traceId", equalTo("trace-456"))
        .body("source", equalTo("chained"));
  }
}
