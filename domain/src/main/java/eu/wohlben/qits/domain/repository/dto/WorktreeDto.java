package eu.wohlben.qits.domain.repository.dto;

import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import java.time.Instant;

/**
 * @param ahead commits the worktree's branch has that its parent does not (commits in front)
 * @param behind commits the parent has that the worktree's branch does not (commits it trails by)
 * @param conflictsWithParent whether merging the parent into this branch would hit merge conflicts.
 *     Only computed (and ever {@code true}) when the branch has diverged from its parent (both
 *     ahead and behind); {@code false} for branches that can be fast-forwarded or merged cleanly.
 *     Drives the "cannot integrate cleanly" warning in the branch tree.
 * @param status the worktree's resolution state (ACTIVE, or INTEGRATED/ABANDONED for history)
 * @param preamble markdown: the reason/goal authored at creation
 * @param result markdown: the outcome authored at resolution
 * @param resolvedAt when the worktree was resolved (null while ACTIVE)
 */
public record WorktreeDto(
    String worktreeId,
    String parent,
    String branch,
    Integer ahead,
    Integer behind,
    boolean conflictsWithParent,
    WorktreeStatus status,
    String preamble,
    String result,
    Instant resolvedAt) {}
