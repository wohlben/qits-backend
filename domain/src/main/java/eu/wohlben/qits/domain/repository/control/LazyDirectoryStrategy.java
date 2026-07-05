package eu.wohlben.qits.domain.repository.control;

import java.util.List;

/**
 * Decides which directories of a workspace are returned as <em>lazy stubs</em> — shown in the file
 * tree as collapsed folders whose contents are fetched on demand — instead of being walked eagerly.
 *
 * <p>This is the pluggable seam behind lazy directory exploration: the default {@link
 * GitignoreLazyDirectoryStrategy} treats gitignored directories as the lazy boundary, but future
 * heuristics (commit frequency, size, age, …) can slot in behind this interface without touching
 * the {@code /files} transport or the UI. The active strategy is selected by the {@code
 * qits.repositories.file-tree.laziness} config property, matched against {@link #id()}.
 */
public interface LazyDirectoryStrategy {

  /** The config id this strategy answers to (e.g. {@code "gitignore"}). */
  String id();

  /**
   * The workspace-root-relative directory paths (no trailing slash) that should be returned as lazy
   * stubs rather than recursed into. Cheap by contract — a strategy must not walk the directories
   * it marks lazy.
   *
   * @param repoId the repository the workspace belongs to
   * @param workspaceId the workspace whose tree is being listed
   * @param access the workspace file access (reads run inside the workspace's container)
   */
  List<String> lazyDirectories(String repoId, String workspaceId, WorkspaceFileAccess access);
}
