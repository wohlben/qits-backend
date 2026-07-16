package eu.wohlben.qits.security.oidc;

import static io.restassured.RestAssured.given;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.oidc.server.OidcWiremockTestResource;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * The optional {@code qits.auth.required-role} knob: an authenticated identity without the role is
 * a 403, with it a 200. (The WireMock tokens carry roles in the {@code groups} claim, which
 * quarkus-oidc's default role mapping picks up.)
 */
@QuarkusTest
@TestProfile(OidcRequiredRoleTest.Profile.class)
@QuarkusTestResource(value = OidcWiremockTestResource.class, restrictToAnnotatedClass = true)
class OidcRequiredRoleTest {

  public static class Profile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.auth.required-role", "admin");
    }
  }

  @Test
  void authenticatedWithoutTheRoleIsForbidden() {
    given()
        .header(
            "Authorization",
            "Bearer " + OidcWiremockTestResource.getAccessToken("alice", Set.of("user")))
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(403);
  }

  @Test
  void authenticatedWithTheRoleIsAllowed() {
    given()
        .header(
            "Authorization",
            "Bearer " + OidcWiremockTestResource.getAccessToken("alice", Set.of("user", "admin")))
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(200);
  }
}
