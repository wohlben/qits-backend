package eu.wohlben.qits.domain.featureflow.mcp;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.project.api.ProjectController;
import io.quarkiverse.mcp.server.ToolResponse;
import io.quarkiverse.mcp.server.test.McpAssured;
import io.quarkiverse.mcp.server.test.McpAssured.McpStreamableTestClient;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.http.ContentType;
import io.vertx.core.MultiMap;
import jakarta.ws.rs.core.Response;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Verifies the "actions" MCP server: unscoped it manages the global library; with an {@code
 * X-QITS-Repository} header it additionally manages that repository's own actions, and those tools
 * are only listed when the header is present.
 */
@QuarkusTest
@TestProfile(ActionConfigurationMcpToolsTest.TestProfile.class)
public class ActionConfigurationMcpToolsTest {

  /** Isolate cloned repos in a temp dir (creating a repository clones the fixture). */
  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-actions-mcp-test-repos");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  private final String fixtureUrl;

  public ActionConfigurationMcpToolsTest() throws Exception {
    fixtureUrl = getClass().getResource("/fixtures/testing-repo.git").toURI().getPath();
  }

  private static String text(ToolResponse response) {
    return response.content().stream()
        .map(c -> c.asText().text())
        .collect(Collectors.joining("\n"));
  }

  /** The actions server, unscoped (global management). */
  private McpStreamableTestClient globalClient() {
    return McpAssured.newStreamableClient().setMcpPath("/mcp/actions").build().connect();
  }

  /** The actions server, scoped to a repository via the X-QITS-Repository header. */
  private McpStreamableTestClient repoClient(String repoId) {
    return McpAssured.newStreamableClient()
        .setMcpPath("/mcp/actions")
        .setAdditionalHeaders(
            msg -> {
              MultiMap headers = MultiMap.caseInsensitiveMultiMap();
              headers.add(RepositoryScope.REPOSITORY_HEADER, repoId);
              return headers;
            })
        .build()
        .connect();
  }

  private McpStreamableTestClient discoveryClient() {
    return McpAssured.newStreamableClient().setMcpPath("/mcp").build().connect();
  }

  private String createProject(String name) {
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRequest(name, null))
        .when()
        .post("/api/projects")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("project.id");
  }

  private String createRepository(String projectId) {
    return given()
        .contentType(ContentType.JSON)
        .body(new ProjectController.CreateProjectRepositoryRequest(fixtureUrl, null))
        .when()
        .post("/api/projects/" + projectId + "/repositories")
        .then()
        .statusCode(Response.Status.OK.getStatusCode())
        .extract()
        .path("repository.id");
  }

  // --- Global tools ---------------------------------------------------------

  @Test
  public void createsAndListsGlobalActionsUnscoped() {
    // Separate chains so the create's transaction has committed before the list reads it (chaining
    // both in one McpAssured chain does not order the write before the read).
    globalClient()
        .when()
        .toolsCall(
            "createGlobalAction",
            Map.of("name", "MCP Global Action", "executeScript", "echo g", "interactive", false),
            response -> {
              assertFalse(response.isError(), "global create should succeed: " + text(response));
              assertTrue(text(response).contains("MCP Global Action"), text(response));
            })
        .thenAssertResults();

    globalClient()
        .when()
        .toolsCall(
            "listGlobalActions",
            Map.of(),
            response -> assertTrue(text(response).contains("MCP Global Action"), text(response)))
        .thenAssertResults();
  }

  // --- Conditional exposure -------------------------------------------------

  @Test
  public void repositoryToolsAreHiddenWhenUnscoped() {
    globalClient()
        .when()
        .toolsList(
            page -> {
              var names = page.tools().stream().map(t -> t.name()).toList();
              assertTrue(names.contains("listGlobalActions"), "global tools present: " + names);
              assertFalse(
                  names.contains("createRepositoryAction"),
                  "repo tools must be hidden when unscoped: " + names);
              assertFalse(names.contains("listRepositoryActions"), "hidden: " + names);
            })
        .thenAssertResults();
  }

  @Test
  public void repositoryToolsAppearWhenScoped() {
    String project = createProject("Scoped Actions");
    String repoId = createRepository(project);

    repoClient(repoId)
        .when()
        .toolsList(
            page -> {
              var names = page.tools().stream().map(t -> t.name()).toList();
              assertTrue(
                  names.contains("createRepositoryAction"),
                  "repo tools present when scoped: " + names);
              assertTrue(names.contains("listRepositoryActions"), names.toString());
              // global tools remain available too
              assertTrue(names.contains("listGlobalActions"), names.toString());
            })
        .thenAssertResults();
  }

  // --- Repository tools -----------------------------------------------------

  @Test
  public void createsARepositoryActionAndSeesItInTheEffectiveSet() {
    String project = createProject("Repo Actions");
    String repoId = createRepository(project);
    // a global action exists too, so we can prove the effective set merges both
    globalClient()
        .when()
        .toolsCall(
            "createGlobalAction",
            Map.of("name", "Shared Global", "executeScript", "echo s", "interactive", false),
            response -> assertFalse(response.isError(), text(response)))
        .thenAssertResults();

    repoClient(repoId)
        .when()
        .toolsCall(
            "createRepositoryAction",
            Map.of("name", "Repo Test Suite", "executeScript", "mvn test", "interactive", false),
            response -> {
              assertFalse(response.isError(), "repo create should succeed: " + text(response));
              String text = text(response);
              assertTrue(text.contains("Repo Test Suite"), text);
              assertTrue(text.contains("REPOSITORY"), "should be repository-scoped: " + text);
              assertTrue(text.contains(repoId), "should carry its repositoryId: " + text);
            })
        .thenAssertResults();

    // Separate chain: the effective set is read after the create has committed.
    repoClient(repoId)
        .when()
        .toolsCall(
            "listRepositoryActions",
            Map.of(),
            response -> {
              String text = text(response);
              assertTrue(text.contains("Repo Test Suite"), "own action listed: " + text);
              assertTrue(text.contains("Shared Global"), "global inherited: " + text);
            })
        .thenAssertResults();
  }

  @Test
  public void repositoryActionsAreIsolatedAcrossRepositories() {
    String project = createProject("Two Repos");
    String repoA = createRepository(project);
    String repoB = createRepository(project);

    String[] holder = new String[1];
    repoClient(repoA)
        .when()
        .toolsCall(
            "createRepositoryAction",
            Map.of("name", "A Only", "executeScript", "echo a", "interactive", false),
            response -> holder[0] = idFrom(text(response)))
        .thenAssertResults();

    // repo B must not see or get repo A's action
    repoClient(repoB)
        .when()
        .toolsCall(
            "getRepositoryAction",
            Map.of("id", holder[0]),
            response -> {
              assertTrue(response.isError(), "cross-repository access must be refused");
              assertTrue(text(response).contains("not found"), text(response));
            })
        .toolsCall(
            "listRepositoryActions",
            Map.of(),
            response -> assertFalse(text(response).contains("A Only"), text(response)))
        .thenAssertResults();
  }

  @Test
  public void discoveryAdvertisesTheActionsServerWithItsRepositoryHeader() {
    discoveryClient()
        .when()
        .toolsCall(
            "listContextServers",
            Map.of(),
            response -> {
              assertFalse(response.isError());
              String text = text(response);
              assertTrue(text.contains("/mcp/actions"), "should advertise its path: " + text);
              assertTrue(
                  text.contains(RepositoryScope.REPOSITORY_HEADER),
                  "should advertise the repository header: " + text);
            })
        .thenAssertResults();
  }

  /** Pulls the "id" out of a returned action JSON. */
  private static String idFrom(String json) {
    int i = json.indexOf("\"id\"");
    int colon = json.indexOf(':', i);
    int firstQuote = json.indexOf('"', colon + 1);
    int secondQuote = json.indexOf('"', firstQuote + 1);
    return json.substring(firstQuote + 1, secondQuote);
  }
}
