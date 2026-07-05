package eu.wohlben.qits.domain.agent.api;

import eu.wohlben.qits.domain.agent.control.PromptRefinementService;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * Refines a raw speech-to-text transcript into a coherent coding-agent prompt, contextualized by
 * the workspace it targets. The heavy lifting is a synchronous one-shot Claude call on a small
 * model (see {@link PromptRefinementService}), so a request typically takes a few seconds.
 */
@Path("/repositories/{repoId}/workspaces/{workspaceId}/prompt-refinements")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PromptRefinementController {

  @Inject PromptRefinementService promptRefinementService;

  public static record RefinePromptRequest(@NotBlank String transcript) {
    public record Response(String prompt) {}
  }

  @POST
  public RefinePromptRequest.Response refine(
      @PathParam("repoId") String repoId,
      @PathParam("workspaceId") String workspaceId,
      @Valid RefinePromptRequest request) {
    return new RefinePromptRequest.Response(
        promptRefinementService.refine(repoId, workspaceId, request.transcript()));
  }
}
