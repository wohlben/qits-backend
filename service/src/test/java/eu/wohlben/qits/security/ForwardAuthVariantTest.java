package eu.wohlben.qits.security;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * End-to-end proof that the variant wiring reaches the full service surface (the service suite runs
 * under -Dqits.variant=forwardauth — see
 * docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md; the fine-grained
 * mechanism coverage lives in the auth modules' own suites). The %test dev-user fallback is blanked
 * here so the real prod posture shows: protected paths 401 without the proxy header — including
 * /service/*, a raw router route — while the container-facing public surface (git host, OTLP
 * ingest, health) stays token-free.
 */
@QuarkusTest
@TestProfile(ForwardAuthVariantTest.Profile.class)
class ForwardAuthVariantTest {

  public static class Profile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.auth.forward.dev-user", "");
    }
  }

  @Test
  void apiIsDeniedWithoutTheProxyHeaderAndOpenWithIt() {
    given().redirects().follow(false).when().get("/api/projects").then().statusCode(401);
    given().header("Remote-User", "alice").when().get("/api/projects").then().statusCode(200);
  }

  @Test
  void serviceProxyIsProtectedDespiteBeingARawRouterRoute() {
    given()
        .redirects()
        .follow(false)
        .when()
        .get("/service/some-workspace/some-service/")
        .then()
        .statusCode(401);
  }

  @Test
  void authStatusReportsTheVariant() {
    given()
        .when()
        .get("/api/auth/me")
        .then()
        .statusCode(200)
        .body("variant", equalTo("forwardauth"));
  }

  @Test
  void healthStaysOpenForProbes() {
    given().when().get("/q/health/ready").then().statusCode(200);
  }

  @Test
  void gitHostStaysTokenFree() {
    // Unknown repo: the git host itself answers 404 — no 401 challenge before it.
    given()
        .redirects()
        .follow(false)
        .when()
        .get("/git/unknown-repo/info/refs?service=git-upload-pack")
        .then()
        .statusCode(404);
  }

  @Test
  void otelIngestStaysTokenFree() {
    // An empty protobuf body is a valid empty export request — accepted without any token.
    given()
        .contentType("application/x-protobuf")
        .body(new byte[0])
        .when()
        .post("/api/otel/v1/logs")
        .then()
        .statusCode(200);
  }
}
