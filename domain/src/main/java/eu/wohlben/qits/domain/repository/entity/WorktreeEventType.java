package eu.wohlben.qits.domain.repository.entity;

/** A lifecycle event in a worktree's history timeline. */
public enum WorktreeEventType {
  /** The worktree was created off its parent. */
  CREATED,
  /** The worktree's branch was merged into a target branch (the worktree stays active). */
  MERGED,
  /** The parent was merged into the worktree (kept up to date). */
  UPDATED_FROM_PARENT,
  /** The worktree was resolved by integration (branch merged, then cleaned up). */
  INTEGRATED,
  /** The worktree was resolved by abandonment (discarded). */
  ABANDONED
}
