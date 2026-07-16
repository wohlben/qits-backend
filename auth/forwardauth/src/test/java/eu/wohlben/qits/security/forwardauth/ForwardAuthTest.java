package eu.wohlben.qits.security.forwardauth;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

/**
 * The forwardauth variant's prod posture (dev-user fallback blanked): the proxy-injected user
 * header is the identity, its absence on a protected path is a plain 401 (no redirect — the proxy
 * owns login), and the container-facing public surface stays token-free. {@code /rawroute} denial
 * is the regression test that the global policy covers raw Vert.x router routes, not just JAX-RS.
 */
@QuarkusTest
@TestProfile(NoDevUserProfile.class)
class ForwardAuthTest {

  @Test
  void missingHeaderIsDeniedWithPlain401() {
    given().redirects().follow(false).when().get("/api/dummy").then().statusCode(401);
  }

  @Test
  void rawRouterRouteIsProtectedDespiteNotBeingJaxRs() {
    given().redirects().follow(false).when().get("/rawroute").then().statusCode(401);
  }

  @Test
  void proxyInjectedHeaderEstablishesTheIdentity() {
    given().header("Remote-User", "alice").when().get("/api/dummy").then().statusCode(200);
  }

  @Test
  void authStatusIsPublicAndReportsVariantAndIdentity() {
    given()
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("forwardauth"))
        .body("username", nullValue());
    given()
        .header("Remote-User", "alice")
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("forwardauth"))
        .body("username", equalTo("alice"));
  }

  @Test
  void publicListedRawRouteStaysTokenFree() {
    given().redirects().follow(false).when().get("/git/ping").then().statusCode(200);
  }

  @Test
  void blankHeaderIsAnonymousNotAnEmptyPrincipal() {
    given().header("Remote-User", "  ").when().get("/api/dummy").then().statusCode(401);
  }
}
