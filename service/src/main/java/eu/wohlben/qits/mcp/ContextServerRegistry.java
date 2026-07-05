package eu.wohlben.qits.mcp;

import eu.wohlben.qits.domain.featureflow.mcp.RepositoryScope;
import eu.wohlben.qits.domain.repository.mcp.ProjectScope;
import eu.wohlben.qits.domain.telemetry.mcp.WorkspaceScope;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The catalogue of specialized "context" MCP servers, exposed by the discovery server (see {@link
 * DiscoveryMcpTools}). Each context server is a tightly scoped toolset; a client connects to one of
 * them rather than to a single firehose, which keeps the model focused. Adding a new context server
 * is a one-liner here plus its {@code @McpServer("<name>")} tool bean.
 *
 * <p>Paths are read from config so this never drifts from the actual {@code
 * quarkus.mcp.server.<name>.http.root-path} mappings.
 */
@ApplicationScoped
public class ContextServerRegistry {

  /**
   * A context MCP server a client can connect to.
   *
   * @param name the server's name (its {@code @McpServer} value)
   * @param description what the toolset is for
   * @param path the Streamable HTTP endpoint path, relative to this app's base URL
   * @param ssePath the legacy SSE endpoint path
   * @param scopeHeader the request header a connection must send to scope itself (null when the
   *     server needs no scope)
   * @param requiresProjectScope whether {@code scopeHeader} must carry a project id (see {@link
   *     DiscoveryMcpTools#listProjects()} for valid ids)
   */
  public record ContextServer(
      String name,
      String description,
      String path,
      String ssePath,
      String scopeHeader,
      boolean requiresProjectScope) {}

  @ConfigProperty(
      name = "quarkus.mcp.server.repository.http.root-path",
      defaultValue = "/mcp/repository")
  String repositoryPath;

  @ConfigProperty(name = "quarkus.mcp.server.actions.http.root-path", defaultValue = "/mcp/actions")
  String actionsPath;

  /** Every context server a client may connect to. */
  public List<ContextServer> all() {
    return List.of(
        new ContextServer(
            "repository",
            "Branches, commits and diffs of a project's repositories, plus the actions on them:"
                + " branch off a workspace, clean up a branch, integrate a branch, and merge a"
                + " parent (e.g. master) into a workspace. Also owns the repositories' daemons —"
                + " long-running processes such as a dev server: define/edit them and start/stop"
                + " them in a workspace. Sessions additionally narrowed to a workspace (the '"
                + WorkspaceScope.WORKSPACE_HEADER
                + "' header or '?workspaceId=') also get the telemetry* tools: structured spans,"
                + " logs and metrics exported by the workspace's instrumented processes.",
            repositoryPath,
            repositoryPath + "/sse",
            ProjectScope.PROJECT_HEADER,
            true),
        new ContextServer(
            "actions",
            "CRUD over actions: the preconfigured processes workspaces can run (an interactive"
                + " shell/Claude Code, or a one-off command like 'mvn test'). Unscoped, it manages"
                + " the global library (the *GlobalAction tools). Send the '"
                + RepositoryScope.REPOSITORY_HEADER
                + "' header set to a repository id to also manage that repository's own actions (the"
                + " *RepositoryAction tools).",
            actionsPath,
            actionsPath + "/sse",
            null,
            false));
  }
}
