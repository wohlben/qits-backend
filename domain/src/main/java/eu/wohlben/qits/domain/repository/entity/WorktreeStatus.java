package eu.wohlben.qits.domain.repository.entity;

/**
 * The resolution state of a worktree. Worktrees are soft-deleted: cleanup/discard removes the
 * on-disk worktree and its branch but keeps the row as a persistent record of the unit of work.
 * Only one {@code ACTIVE} worktree may exist per {@code (repository, worktreeId)} at a time;
 * resolved rows accumulate as history (so a worktree id can be reused once its predecessor is
 * resolved).
 */
public enum WorktreeStatus {
  /** Live: checked out on disk, with a branch. */
  ACTIVE,
  /** Resolved by integrating its branch (cleaned up after a merge). */
  INTEGRATED,
  /** Resolved by abandoning it (discarded without integrating). */
  ABANDONED
}
