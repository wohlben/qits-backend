package eu.wohlben.qits.domain.featureflow.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.quarkiverse.mcp.server.ToolResponse;
import io.quarkiverse.mcp.server.test.McpAssured;
import io.quarkiverse.mcp.server.test.McpAssured.McpStreamableTestClient;
import io.quarkus.test.junit.QuarkusTest;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Verifies the "actions" MCP server: since Part 5 (config-as-single-source-of-truth) it manages
 * only the global (code-based) action library — config-declared workspace actions live in {@code
 * .qits-config.yml} and are edited as the file, not via MCP.
 */
@QuarkusTest
public class ActionConfigurationMcpToolsTest {

  /** Isolate any cloned repos in a temp dir, like the other MCP tests. */
  private static String text(ToolResponse response) {
    return response.content().stream()
        .map(c -> c.asText().text())
        .collect(Collectors.joining("\n"));
  }

  /** The actions server (global library management). */
  private McpStreamableTestClient globalClient() {
    return McpAssured.newStreamableClient().setMcpPath("/mcp/actions").build().connect();
  }

  private McpStreamableTestClient discoveryClient() {
    return McpAssured.newStreamableClient().setMcpPath("/mcp").build().connect();
  }

  @Test
  public void createsAndListsGlobalActions() {
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

  @Test
  public void exposesExactlyTheGlobalLibraryTools() {
    // The repository-scoped tools are gone (Part 5): the server is the global library's CRUD and
    // nothing else.
    globalClient()
        .when()
        .toolsList(
            page -> {
              var names = page.tools().stream().map(t -> t.name()).toList();
              assertEquals(
                  java.util.Set.of(
                      "listGlobalActions",
                      "getGlobalAction",
                      "createGlobalAction",
                      "updateGlobalAction",
                      "deleteGlobalAction"),
                  java.util.Set.copyOf(names),
                  "unexpected tool surface: " + names);
            })
        .thenAssertResults();
  }

  @Test
  public void discoveryAdvertisesTheActionsServerWithoutARepositoryHeader() {
    // The actions server is unscoped now — discovery names its path but no longer advertises an
    // X-QITS-Repository scoping header for it.
    discoveryClient()
        .when()
        .toolsCall(
            "listContextServers",
            Map.of(),
            response -> {
              assertFalse(response.isError());
              String text = text(response);
              assertTrue(text.contains("/mcp/actions"), "should advertise its path: " + text);
              assertFalse(
                  text.contains("X-QITS-Repository"),
                  "the actions server no longer takes a repository header: " + text);
            })
        .thenAssertResults();
  }
}
