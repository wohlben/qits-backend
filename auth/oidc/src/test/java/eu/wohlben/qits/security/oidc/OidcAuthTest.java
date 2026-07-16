package eu.wohlben.qits.security.oidc;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.oidc.server.OidcWiremockTestResource;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The oauth variant against the WireMock OIDC stub (no real Keycloak): browsers get the code-flow
 * challenge, marked XHRs get the 499 contract, bearer JWTs pass resource-server validation, and the
 * container-facing public surface stays token-free. {@code /rawroute} challenging is the regression
 * test that the global policy covers raw Vert.x router routes, not just JAX-RS (in the service app:
 * the /daemon proxy).
 */
@QuarkusTest
@QuarkusTestResource(value = OidcWiremockTestResource.class, restrictToAnnotatedClass = true)
class OidcAuthTest {

  private static String bearer() {
    return "Bearer " + OidcWiremockTestResource.getAccessToken("alice", Set.of("user"));
  }

  @Test
  void anonymousBrowserRequestIsChallengedWithCodeFlowRedirect() {
    given().redirects().follow(false).when().get("/api/dummy").then().statusCode(302);
  }

  @Test
  void unroutedRootIsBehindTheLoginWall() {
    // In the service app this is the SPA index: the challenge fires before any routing decision.
    given().redirects().follow(false).when().get("/").then().statusCode(302);
  }

  @Test
  void rawRouterRouteIsProtectedDespiteNotBeingJaxRs() {
    given().redirects().follow(false).when().get("/rawroute").then().statusCode(302);
  }

  @Test
  void markedXhrGets499InsteadOfRedirect() {
    given()
        .header("X-Requested-With", "JavaScript")
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(499)
        .header("WWW-Authenticate", containsString("OIDC"));
  }

  @Test
  void bearerTokenPassesResourceServerValidation() {
    given().header("Authorization", bearer()).when().get("/api/dummy").then().statusCode(200);
  }

  @Test
  void garbageBearerTokenIsRejected() {
    given()
        .header("Authorization", "Bearer not-a-jwt")
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(401);
  }

  @Test
  void authStatusIsPublicAndReportsVariantAndIdentity() {
    given()
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("oauth"))
        .body("username", nullValue());
    given()
        .header("Authorization", bearer())
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("oauth"))
        .body("username", equalTo("alice"));
  }

  @Test
  void publicListedRawRouteStaysTokenFree() {
    given().redirects().follow(false).when().get("/git/ping").then().statusCode(200);
  }
}
