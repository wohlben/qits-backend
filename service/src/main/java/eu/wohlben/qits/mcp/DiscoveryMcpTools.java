package eu.wohlben.qits.mcp;

import eu.wohlben.qits.domain.project.control.ProjectService;
import io.quarkiverse.mcp.server.McpServer;
import io.quarkiverse.mcp.server.Tool;
import io.quarkiverse.mcp.server.WrapBusinessError;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;

/**
 * The discovery server, mounted on the default endpoint ({@code /mcp}). It is unscoped on purpose:
 * a client connects here first to find out which specialized context servers exist and which
 * projects it may scope them to, then opens a second connection to the right context server with
 * the appropriate scope header. This keeps every working session narrow without the client having
 * to hardcode endpoint paths or project ids.
 */
@ApplicationScoped
@WrapBusinessError
public class DiscoveryMcpTools {

  @Inject ProjectService projectService;

  @Inject ContextServerRegistry registry;

  /** A project a context server can be scoped to. */
  public record ProjectInfo(String id, String name, String description) {}

  @McpServer(McpServer.DEFAULT)
  @Tool(
      description =
          "List the projects in this qits instance. Use a project's id as the scope header value"
              + " (see listContextServers) when connecting to a context server, so that session"
              + " only ever sees that one project.")
  @Transactional
  public List<ProjectInfo> listProjects() {
    return projectService.list().stream()
        .map(p -> new ProjectInfo(p.id, p.name, p.description))
        .toList();
  }

  @McpServer(McpServer.DEFAULT)
  @Tool(
      description =
          "List the specialized context MCP servers available. Each is a focused toolset reached at"
              + " its own path; connect to the one you need (most are scoped to a single project via"
              + " the named header — pick a project id from listProjects) instead of using one broad"
              + " server, so the model stays on task.")
  public List<ContextServerRegistry.ContextServer> listContextServers() {
    return registry.all();
  }
}
