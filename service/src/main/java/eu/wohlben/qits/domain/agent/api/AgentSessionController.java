package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.AgentSessionQueryService;
import eu.wohlben.qits.domain.agent.dto.AgentSessionNodeDto;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * Read side of the agent-session lineage: every session ever associated with a workspace, shaped as
 * a tree (resumes collapse onto their session, forks nest under their origin, subagent sidechains
 * attach to the session that spawned them). Backs the workspace Agents tab's session history list.
 */
@Path("/repositories/{repoId}/workspaces/{workspaceId}/agent-sessions")
@Produces(MediaType.APPLICATION_JSON)
public class AgentSessionController {

  @Inject AgentSessionQueryService agentSessionQueryService;

  public static record ListAgentSessionsRequest() {
    public record Response(List<AgentSessionNodeDto> sessions) {}
  }

  @GET
  public ListAgentSessionsRequest.Response list(
      @PathParam("repoId") String repoId, @PathParam("workspaceId") String workspaceId) {
    return new ListAgentSessionsRequest.Response(
        agentSessionQueryService.sessionTree(repoId, workspaceId));
  }
}
