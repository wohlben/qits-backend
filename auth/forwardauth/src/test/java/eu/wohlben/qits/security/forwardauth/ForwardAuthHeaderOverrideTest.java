package eu.wohlben.qits.security.forwardauth;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The header names are deploy-time config — e.g. oauth2-proxy's X-Auth-Request-* family. */
@QuarkusTest
@TestProfile(ForwardAuthHeaderOverrideTest.Profile.class)
class ForwardAuthHeaderOverrideTest {

  public static class Profile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of(
          "qits.auth.forward.dev-user", "",
          "qits.auth.forward.user-header", "X-Auth-Request-User");
    }
  }

  @Test
  void configuredHeaderNameIsHonored() {
    given()
        .header("X-Auth-Request-User", "alice")
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("username", equalTo("alice"));
  }

  @Test
  void theDefaultHeaderNameIsIgnoredOnceOverridden() {
    given().header("Remote-User", "alice").when().get("/api/dummy").then().statusCode(401);
  }
}
