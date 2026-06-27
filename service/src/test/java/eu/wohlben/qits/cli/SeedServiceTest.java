package eu.wohlben.qits.cli;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(SeedServiceTest.TestProfile.class)
public class SeedServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-seed-test");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject SeedService seedService;

  @Test
  public void seedsFastForwardableAndDivergedWorktrees() {
    // Called directly (no JAX-RS request context), exactly like the `seed` CLI command —
    // a regression guard for the @ActivateRequestContext on seed().
    assertTrue(seedService.seed(), "first seed should create data");
    assertFalse(seedService.seed(), "second seed should be a no-op (idempotent)");

    String projectId =
        given()
            .when()
            .get("/api/projects")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("entries.find { it.project.name == 'Demo Project' }.project.id");

    String repoId =
        given()
            .when()
            .get("/api/projects/" + projectId + "/repositories")
            .then()
            .statusCode(Response.Status.OK.getStatusCode())
            .extract()
            .path("entries[0].repository.id");

    given()
        .when()
        .get("/api/repositories/" + repoId + "/worktrees")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        // behind-ff: strictly behind its parent, nothing of its own -> fast-forwardable.
        .body("entries.find { it.worktree.worktreeId == 'behind-ff' }.worktree.ahead", equalTo(0))
        .body(
            "entries.find { it.worktree.worktreeId == 'behind-ff' }.worktree.behind",
            greaterThan(0))
        // diverged: both ahead of and behind its parent -> warning, not fast-forwardable.
        .body(
            "entries.find { it.worktree.worktreeId == 'diverged' }.worktree.ahead", greaterThan(0))
        .body(
            "entries.find { it.worktree.worktreeId == 'diverged' }.worktree.behind",
            greaterThan(0));
  }
}
