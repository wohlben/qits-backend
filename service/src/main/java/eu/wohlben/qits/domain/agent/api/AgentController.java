package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.AgentLaunchMode;
import eu.wohlben.qits.domain.agent.control.AgentLaunchService;
import eu.wohlben.qits.domain.agent.control.AgentMcpScope;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.error.BadRequestException;
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
 * The agent code path: launch a coding agent (Claude Code) into a workspace with an MCP server
 * attached, scoped to the repository or project. Separate from actions and the generic {@code
 * /commands} launcher — this is what the "Configure … with Claude" buttons call. Launching returns
 * the command immediately (it is registered like any other), and the terminal is watched on {@code
 * command.id}.
 */
@Path("/repositories/{repoId}/workspaces/{workspaceId}/agents")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AgentController {

  @Inject AgentLaunchService agentLaunchService;

  /**
   * {@code mode} picks chat (default when null) or the interactive TUI. {@code resumeSessionId}
   * continues an existing agent session of this workspace; {@code fork} additionally branches it
   * into a fresh session.
   */
  public static record LaunchAgentRequest(
      @NotNull AgentMcpScope scope,
      String initialContext,
      AgentLaunchMode mode,
      String resumeSessionId,
      Boolean fork) {
    public record Response(CommandDto command) {}
  }

  @POST
  public LaunchAgentRequest.Response launch(
      @PathParam("repoId") String repoId,
      @PathParam("workspaceId") String workspaceId,
      @Valid LaunchAgentRequest request) {
    boolean fork = Boolean.TRUE.equals(request.fork());
    if (fork && (request.resumeSessionId() == null || request.resumeSessionId().isBlank())) {
      throw new BadRequestException("fork requires resumeSessionId");
    }
    CommandDto command =
        request.mode() == AgentLaunchMode.INTERACTIVE
            ? agentLaunchService.launchInteractive(
                repoId,
                workspaceId,
                request.scope(),
                request.initialContext(),
                request.resumeSessionId(),
                fork)
            : agentLaunchService.launchChat(
                repoId,
                workspaceId,
                request.scope(),
                request.initialContext(),
                request.resumeSessionId(),
                fork);
    return new LaunchAgentRequest.Response(command);
  }
}
