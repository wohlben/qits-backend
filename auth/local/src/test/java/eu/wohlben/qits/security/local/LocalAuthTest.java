package eu.wohlben.qits.security.local;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/**
 * The {@code local} variant is explicitly unauthenticated: every request — with no proxy and no
 * header — is authenticated as the fixed local identity, so a protected path is reachable and
 * {@code /api/auth/me} reports the local user. This is the ONE variant that runs open;
 * forwardauth/oidc never do (their own suites prove denial). Unlike forwardauth's fallback, the
 * identity is not LaunchMode-guarded — its behaviour is the same open posture in every mode.
 */
@QuarkusTest
class LocalAuthTest {

  @Test
  void anonymousRequestIsAuthenticatedAsTheLocalIdentity() {
    given().when().get("/api/dummy").then().statusCode(200);
  }

  @Test
  void authStatusReportsTheLocalVariantAndIdentity() {
    given()
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("local"))
        .body("username", equalTo("local"));
  }
}
