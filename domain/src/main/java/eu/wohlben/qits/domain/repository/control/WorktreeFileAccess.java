package eu.wohlben.qits.domain.repository.control;

import java.util.List;

/**
 * The small set of read-only filesystem primitives the worktree file browser needs, decoupled from
 * <em>where</em> a worktree's files live. With workspace containers the working tree is a clone
 * inside a per-worktree Docker container ({@code /workspace}), not a host checkout, so the default
 * {@link ContainerFileAccess} implements these through {@code docker exec}. The seam keeps {@link
 * WorktreeFilesService} pure orchestration + path-safety policy — it never touches {@code
 * java.nio.file} — so the controllers, DTOs and the whole frontend layered on it stay
 * byte-identical.
 *
 * <p>All paths are relative to the worktree root ({@code /workspace}); callers are responsible for
 * the lexical {@code ..}/absolute-escape guard before handing a user-supplied path here.
 */
public interface WorktreeFileAccess {

  /**
   * The kind of a single filesystem entry, mirroring {@code find -printf '%y'} (symlinks
   * unfollowed).
   */
  enum EntryType {
    FILE,
    DIRECTORY,
    SYMLINK,
    OTHER,
    MISSING
  }

  /**
   * One filesystem entry. {@code path} is worktree-root-relative; {@code size} is the byte size for
   * files (0 otherwise); {@code childCount} is the immediate-child count for directories (0
   * otherwise), populated by {@link #list} for the subdirectories it returns.
   */
  record Entry(String path, EntryType type, long size, int childCount) {}

  /**
   * Runs {@code git <args>} in the worktree root and returns its combined stdout, throwing on a
   * non-zero exit. Used for the git-aware listings (tracked + untracked, ignored dirs) the browser
   * and the lazy-directory strategy need.
   */
  String git(String repoId, String worktreeId, String... args);

  /**
   * The type and size of a single path <em>without following symlinks</em>. Returns an entry with
   * {@link EntryType#MISSING} (and zero size/childCount) when the path does not exist.
   */
  Entry stat(String repoId, String worktreeId, String path);

  /**
   * Lists a directory one level deep. Immediate regular files and symlinks are returned with their
   * type; immediate subdirectories carry their {@code childCount}. Symlinked directories are
   * reported as {@link EntryType#SYMLINK} and never descended into.
   */
  List<Entry> list(String repoId, String worktreeId, String dir);

  /**
   * The cheap immediate-child count of a directory (one level, never a recursive descendant walk).
   */
  int childCount(String repoId, String worktreeId, String dir);

  /**
   * Whether {@code path} resolves — following <em>every</em> intermediate and final symlink — to a
   * location still inside the worktree root. This is the containment guard the lexical {@code ..}
   * check cannot provide: a committed symlink at any path segment (e.g. a {@code linkdir/} symlink
   * to an absolute path) that points outside the worktree is rejected. A missing path, or a broken
   * or looping symlink, resolves to {@code false}. Cloned repositories are untrusted and git checks
   * out symlinks, so this must run before any {@code find}/{@code cat} that would otherwise
   * dereference an intermediate link.
   */
  boolean resolvesInsideRoot(String repoId, String worktreeId, String path);

  /**
   * The raw bytes of a regular file, streamed exactly (no TTY, no charset round-trip) so binary
   * content and line endings survive. The caller enforces the size limit (via {@link #stat}) before
   * reading and does binary sniffing on the returned bytes.
   */
  byte[] read(String repoId, String worktreeId, String path);
}
