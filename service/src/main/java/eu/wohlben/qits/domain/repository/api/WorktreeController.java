package eu.wohlben.qits.domain.repository.api;

import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.mapper.WorktreeMapper;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/repositories/{repoId}/worktrees")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class WorktreeController {

    @Inject
    WorktreeService worktreeService;

    @Inject
    WorktreeMapper worktreeMapper;

    public static record CreateWorktreeRequest(@NotBlank String id,
                                                String parent,
                                                String branch) {
        public record Response(WorktreeDto worktree) {}
    }

    @POST
    public CreateWorktreeRequest.Response create(@PathParam("repoId") String repoId, @Valid CreateWorktreeRequest request) {
        var wt = worktreeService.createWorktree(repoId, request.id(), request.parent(), request.branch());
        return new CreateWorktreeRequest.Response(worktreeMapper.toDto(wt));
    }

    public static record MergeWorktreeRequest(String target) {
        public record Response(String commitHash, boolean hasConflicts, String output) {}
    }

    @POST
    @Path("/{worktreeId}/merge")
    public MergeWorktreeRequest.Response merge(@PathParam("repoId") String repoId,
                                                @PathParam("worktreeId") String worktreeId,
                                                @Valid MergeWorktreeRequest request) {
        var result = worktreeService.mergeWorktree(repoId, worktreeId, request.target());
        return new MergeWorktreeRequest.Response(result.commitHash(), result.hasConflicts(), result.output());
    }

    public static record DiscardWorktreeRequest() {
        public record Response(boolean success) {}
    }

    @POST
    @Path("/{worktreeId}/discard")
    public DiscardWorktreeRequest.Response discard(@PathParam("repoId") String repoId,
                                                    @PathParam("worktreeId") String worktreeId,
                                                    @Valid DiscardWorktreeRequest request) {
        worktreeService.discardWorktree(repoId, worktreeId);
        return new DiscardWorktreeRequest.Response(true);
    }
}
