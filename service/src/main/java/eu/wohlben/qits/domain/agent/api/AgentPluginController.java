package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.AgentPluginService;
import eu.wohlben.qits.domain.agent.dto.InstalledPluginDto;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * The coding agent's LSP-plugin surface for a workspace: list which plugins are installed on the
 * shared credential volume and install one. The store is <strong>global</strong> to the volume
 * (installing from any workspace flips it green in every workspace), so these hang off a workspace
 * only because a workspace owns the container the op runs inside — see {@link AgentPluginService}
 * and {@code docs/epics/qits-coding-agents/features/2026-07-07_agent-lsp-plugins.md}. The curated
 * list of installable plugins (ids, labels, framework hints) lives in the frontend and is joined
 * against this status.
 */
@Path("/repositories/{repoId}/workspaces/{workspaceId}/agent-plugins")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AgentPluginController {

  @Inject AgentPluginService agentPluginService;

  /** The plugins installed on the shared volume (absent-from-the-file counts as not installed). */
  public record ListAgentPluginsResponse(List<InstalledPluginDto> installed) {}

  @GET
  public ListAgentPluginsResponse list(
      @PathParam("repoId") String repoId, @PathParam("workspaceId") String workspaceId) {
    return new ListAgentPluginsResponse(agentPluginService.listInstalled(repoId, workspaceId));
  }

  @POST
  @Path("/{pluginId}/install")
  public ListAgentPluginsResponse install(
      @PathParam("repoId") String repoId,
      @PathParam("workspaceId") String workspaceId,
      @PathParam("pluginId") String pluginId) {
    return new ListAgentPluginsResponse(agentPluginService.install(repoId, workspaceId, pluginId));
  }
}
