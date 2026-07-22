package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.AgentType;
import eu.wohlben.qits.domain.agent.control.AgentTypeResolver;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * The workspace-independent agent metadata surface: which coding-agent harnesses this instance can
 * launch, and the resolved instance default. Feeds the workspace agent picker so the SPA doesn't
 * hard-code the list and can pre-select the default.
 */
@Path("/agents")
@Produces(MediaType.APPLICATION_JSON)
public class AgentsController {

  @Inject AgentTypeResolver agentTypeResolver;

  public static record AvailableAgentsRequest() {
    public record Response(List<AgentType> agents, AgentType defaultAgent) {}
  }

  @GET
  @Path("/available")
  public AvailableAgentsRequest.Response available() {
    return new AvailableAgentsRequest.Response(
        List.of(AgentType.values()), agentTypeResolver.resolve(null));
  }
}
