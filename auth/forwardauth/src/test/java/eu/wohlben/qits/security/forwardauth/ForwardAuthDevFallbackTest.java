package eu.wohlben.qits.security.forwardauth;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/**
 * The default test posture — the module's %test dev-user fallback is active, exactly like %dev mode
 * without a proxy: anonymous requests authenticate as the synthetic "dev" identity, which is what
 * keeps the whole service test suite (and everyday quarkus:dev) friction-free under this variant. A
 * real header still wins over the fallback.
 */
@QuarkusTest
class ForwardAuthDevFallbackTest {

  @Test
  void anonymousRequestFallsBackToTheDevIdentity() {
    given().when().get("/api/dummy").then().statusCode(200);
    given().when().get("/api/auth/me").then().statusCode(200).body("username", equalTo("dev"));
  }

  @Test
  void realHeaderWinsOverTheFallback() {
    given()
        .header("Remote-User", "alice")
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("username", equalTo("alice"));
  }
}
