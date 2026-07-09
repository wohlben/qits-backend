package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * The actions <em>effective</em> in a repository: the merge of the global library and the
 * repository's own actions (the REST twin of the MCP {@code listRepositoryActions} tool). Read-only
 * — global actions are managed under {@code /action-configurations}, repository-scoped ones via
 * MCP. Nested under the repository because that is the resolution scope; a workspace only supplies
 * <em>where</em> a launched action executes.
 */
@Path("/repositories/{repositoryId}/actions")
@Produces(MediaType.APPLICATION_JSON)
public class RepositoryActionsController {

  @Inject ActionResolutionService actionResolutionService;

  public static record ListEffectiveActionsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(ActionConfigurationDto action) {}
    }
  }

  @GET
  public ListEffectiveActionsRequest.Response list(@PathParam("repositoryId") String repositoryId) {
    var entries =
        actionResolutionService.effectiveActions(repositoryId).stream()
            .map(ListEffectiveActionsRequest.Response.Entry::new)
            .toList();
    return new ListEffectiveActionsRequest.Response(entries);
  }
}
