package eu.wohlben.qits.domain.repository.dto;

/**
 * @param ahead commits the worktree's branch has that its parent does not (commits in front)
 * @param behind commits the parent has that the worktree's branch does not (commits it trails by)
 */
public record WorktreeDto(
    String worktreeId, String parent, String branch, Integer ahead, Integer behind) {}
