package eu.wohlben.qits.domain.bootstrap.api;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import eu.wohlben.qits.domain.bootstrap.api.BootstrapCommandController.CreateBootstrapCommandRequest;
import eu.wohlben.qits.domain.bootstrap.api.BootstrapCommandController.OrderBootstrapCommandsRequest;
import eu.wohlben.qits.domain.bootstrap.api.BootstrapCommandController.UpdateBootstrapCommandRequest;
import eu.wohlben.qits.domain.project.api.ProjectController;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * CRUD + reorder round-trip over a repository's bootstrap chain, including ownership enforcement
 * and the reserved {@code @qits-config} suffix guard.
 */
@QuarkusTest
@TestProfile(BootstrapCommandControllerTest.TestProfile.class)
public class BootstrapCommandControllerTest {

  /** Isolate cloned repos in a temp dir, like the other repository-backed tests. */
  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-bootstrap-controller-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public BootstrapCommandControllerTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private String createRepository() {
    String projectId =
        given()
            .contentType(ContentType.JSON)
            .body(new ProjectController.CreateProjectRequest("Bootstrap Project", null))
            .post("/api/projects")
            .then()
            .statusCode(200)
            .extract()
            .path("project.id");
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRepositoryRequest(fixtureUrl, null, null))
        .post("/api/projects/" + projectId + "/repositories")
        .then()
        .statusCode(200)
        .extract()
        .path("repository.id");
  }

  private String create(String repoId, String name) {
    return given()
        .contentType(ContentType.JSON)
        .body(
            new CreateBootstrapCommandRequest(
                name,
                "installs deps",
                "./mvnw install -DskipTests",
                "test ! -f marker",
                Map.of("MAVEN_OPTS", "-Xmx2g"),
                null))
        .post("/api/repositories/" + repoId + "/bootstrap-commands")
        .then()
        .statusCode(200)
        .body("command.name", equalTo(name))
        .body("command.origin", equalTo("UI"))
        .extract()
        .path("command.id");
  }

  @Test
  public void createGetListRoundTrip() {
    String repoId = createRepository();
    String id = create(repoId, "install");

    given()
        .get("/api/repositories/" + repoId + "/bootstrap-commands/" + id)
        .then()
        .statusCode(200)
        .body("command.name", equalTo("install"))
        .body("command.executeScript", equalTo("./mvnw install -DskipTests"))
        .body("command.checkScript", equalTo("test ! -f marker"))
        .body("command.orderIndex", equalTo(0))
        .body("command.environment.MAVEN_OPTS", equalTo("-Xmx2g"));

    create(repoId, "seed");
    given()
        .get("/api/repositories/" + repoId + "/bootstrap-commands")
        .then()
        .statusCode(200)
        .body("entries", hasSize(2))
        .body("entries[0].command.name", equalTo("install"))
        .body("entries[1].command.name", equalTo("seed"))
        .body("entries[1].command.orderIndex", equalTo(1));
  }

  @Test
  public void updateIsPartialAndBlankCheckClears() {
    String repoId = createRepository();
    String id = create(repoId, "step");

    given()
        .contentType(ContentType.JSON)
        .body(new UpdateBootstrapCommandRequest(null, "new description", null, "", null, null))
        .put("/api/repositories/" + repoId + "/bootstrap-commands/" + id)
        .then()
        .statusCode(200)
        .body("command.name", equalTo("step"))
        .body("command.description", equalTo("new description"))
        .body("command.executeScript", equalTo("./mvnw install -DskipTests"))
        .body("command.checkScript", nullValue());
  }

  @Test
  public void orderEndpointRestampsTheWholeChain() {
    String repoId = createRepository();
    String install = create(repoId, "install");
    String seed = create(repoId, "seed");

    given()
        .contentType(ContentType.JSON)
        .body(new OrderBootstrapCommandsRequest(List.of(seed, install)))
        .put("/api/repositories/" + repoId + "/bootstrap-commands/order")
        .then()
        .statusCode(200)
        .body("entries", hasSize(2))
        .body("entries[0].command.name", equalTo("seed"))
        .body("entries[0].command.orderIndex", equalTo(0))
        .body("entries[1].command.name", equalTo("install"))
        .body("entries[1].command.orderIndex", equalTo(1));

    // A partial id list is rejected — reorder is all-or-nothing.
    given()
        .contentType(ContentType.JSON)
        .body(new OrderBootstrapCommandsRequest(List.of(seed)))
        .put("/api/repositories/" + repoId + "/bootstrap-commands/order")
        .then()
        .statusCode(400);
  }

  @Test
  public void deleteRemovesAndOwnershipIsEnforced() {
    String repoId = createRepository();
    String otherRepoId = createRepository();
    String id = create(repoId, "install");

    // The wrong repository cannot see or delete the command.
    given()
        .get("/api/repositories/" + otherRepoId + "/bootstrap-commands/" + id)
        .then()
        .statusCode(404);
    given()
        .delete("/api/repositories/" + otherRepoId + "/bootstrap-commands/" + id)
        .then()
        .statusCode(404);

    given()
        .delete("/api/repositories/" + repoId + "/bootstrap-commands/" + id)
        .then()
        .statusCode(200)
        .body("success", equalTo(true));
    given().get("/api/repositories/" + repoId + "/bootstrap-commands/" + id).then().statusCode(404);
  }

  @Test
  public void validationRejectsBlankFieldsAndReservedSuffix() {
    String repoId = createRepository();

    given()
        .contentType(ContentType.JSON)
        .body(new CreateBootstrapCommandRequest("", null, "./go", null, null, null))
        .post("/api/repositories/" + repoId + "/bootstrap-commands")
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(new CreateBootstrapCommandRequest("no-script", null, " ", null, null, null))
        .post("/api/repositories/" + repoId + "/bootstrap-commands")
        .then()
        .statusCode(400);
    given()
        .contentType(ContentType.JSON)
        .body(
            new CreateBootstrapCommandRequest("sneaky@qits-config", null, "./go", null, null, null))
        .post("/api/repositories/" + repoId + "/bootstrap-commands")
        .then()
        .statusCode(400);
  }
}
