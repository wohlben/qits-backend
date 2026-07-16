package eu.wohlben.qits.security.forwardauth;

import static io.restassured.RestAssured.given;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The optional {@code qits.auth.required-role} knob under forwardauth: the proxy's comma-separated
 * groups header maps to roles, so the same core policy check works as with oauth token roles.
 */
@QuarkusTest
@TestProfile(ForwardAuthRequiredRoleTest.Profile.class)
class ForwardAuthRequiredRoleTest {

  public static class Profile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of(
          "qits.auth.forward.dev-user", "",
          "qits.auth.required-role", "admin");
    }
  }

  @Test
  void authenticatedWithoutTheGroupIsForbidden() {
    given()
        .header("Remote-User", "alice")
        .header("Remote-Groups", "user")
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(403);
  }

  @Test
  void authenticatedWithTheGroupIsAllowed() {
    // Spaces after commas are how Authelia serializes multiple groups — they must be trimmed.
    given()
        .header("Remote-User", "alice")
        .header("Remote-Groups", "user, admin")
        .when()
        .get("/api/dummy")
        .then()
        .statusCode(200);
  }

  @Test
  void missingGroupsHeaderIsAuthenticatedButRoleless() {
    given().header("Remote-User", "alice").when().get("/api/dummy").then().statusCode(403);
  }
}
