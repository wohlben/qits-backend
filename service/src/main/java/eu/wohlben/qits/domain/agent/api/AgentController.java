package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.AgentLaunchService;
import eu.wohlben.qits.domain.agent.control.AgentMcpScope;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * The agent code path: launch a coding agent (Claude Code) into a worktree with an MCP server
 * attached, scoped to the repository or project. Separate from actions and the generic {@code
 * /commands} launcher — this is what the "Configure … with Claude" buttons call. Launching returns
 * the command immediately (it is registered like any other), and the terminal is watched on {@code
 * command.id}.
 */
@Path("/repositories/{repoId}/worktrees/{worktreeId}/agents")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AgentController {

  @Inject AgentLaunchService agentLaunchService;

  public static record LaunchAgentRequest(@NotNull AgentMcpScope scope, String initialContext) {
    public record Response(CommandDto command) {}
  }

  @POST
  public LaunchAgentRequest.Response launch(
      @PathParam("repoId") String repoId,
      @PathParam("worktreeId") String worktreeId,
      @Valid LaunchAgentRequest request) {
    return new LaunchAgentRequest.Response(
        agentLaunchService.launchChat(
            repoId, worktreeId, request.scope(), request.initialContext()));
  }
}
