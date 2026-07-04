package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorktreeFileContentDto;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Read-only browsing of a worktree's files for the file-browser UI: the file list (git-aware, so
 * build artifacts and ignored files stay out) and the text content of a single file. Every read
 * runs inside the worktree's container ({@code /workspace}) via {@link WorktreeFileAccess}, so the
 * browser shows the container's actual live working tree — an agent's uncommitted edits included —
 * rather than a host checkout (there is none). This class owns only orchestration, sorting and
 * path-safety policy; the exec mechanics live behind {@link WorktreeFileAccess}, and the DTOs it
 * returns are byte-identical to the previous host-path implementation.
 */
@ApplicationScoped
public class WorktreeFilesService {

  /** Files larger than this are reported as {@code binary} rather than streamed into the viewer. */
  private static final long MAX_CONTENT_BYTES = 2_000_000L;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorktreeRepository worktreeRepository;

  @Inject ContainerRuntime containers;

  @Inject WorktreeFileAccess access;

  @Inject @Any Instance<LazyDirectoryStrategy> lazyStrategies;

  @ConfigProperty(name = "qits.repositories.file-tree.laziness", defaultValue = "gitignore")
  String lazinessStrategyId;

  /**
   * A lazily-resolvable directory the active {@link LazyDirectoryStrategy} marked as a boundary:
   * shown in the tree as a collapsed stub, its contents fetched on demand. {@code childCount} is
   * the cheap immediate-child count, not total descendants.
   */
  public record LazyDir(String path, int childCount) {}

  /**
   * One level of a worktree's file tree: eager {@code paths} (files rendered immediately) plus
   * {@code lazyDirs} (collapsed stubs). Returned for both the root and a single lazy directory.
   */
  public record Listing(List<String> paths, List<LazyDir> lazyDirs) {}

  /**
   * Lists a worktree level as a {@link Listing}. With no {@code path} this is the root: eager files
   * from {@code git ls-files --cached --others --exclude-standard} (tracked + new untracked,
   * gitignore honoured) plus the directories the active laziness strategy marked as lazy stubs.
   * With a {@code path} it is that one directory's immediate listing (a lazy directory git refuses
   * to walk), so arbitrarily deep lazy nesting resolves through the same endpoint.
   */
  public Listing listFiles(String repoId, String worktreeId, String path) {
    validate(repoId, worktreeId);
    if (path == null || path.isBlank()) {
      return listRoot(repoId, worktreeId);
    }
    return listDirectory(repoId, worktreeId, path);
  }

  /** The eager (non-lazy) tree from the worktree root, with the strategy's lazy dirs alongside. */
  private Listing listRoot(String repoId, String worktreeId) {
    String output =
        access.git(repoId, worktreeId, "ls-files", "--cached", "--others", "--exclude-standard");
    List<String> paths =
        output.lines().filter(line -> !line.isBlank()).distinct().sorted().toList();

    List<LazyDir> lazyDirs =
        strategy().lazyDirectories(repoId, worktreeId, access).stream()
            .map(dir -> new LazyDir(dir, access.childCount(repoId, worktreeId, dir)))
            .toList();
    return new Listing(paths, lazyDirs);
  }

  /**
   * Lists one directory a single level deep. Immediate regular files become {@code paths};
   * immediate subdirectories become lazy stubs again (the same laziness applies recursively).
   * Symlinks are skipped rather than followed — a symlink committed inside an untrusted worktree
   * must not be walked through. {@code path} is user-supplied, so it is guarded exactly like a file
   * read.
   */
  private Listing listDirectory(String repoId, String worktreeId, String path) {
    if (path.equals(".git") || path.startsWith(".git/")) {
      throw new BadRequestException("Cannot list the .git directory");
    }
    requireSafeRelativePath(path);
    WorktreeFileAccess.Entry stat = access.stat(repoId, worktreeId, path);
    switch (stat.type()) {
      case MISSING -> throw new NotFoundException("Directory not found: " + path);
      // an untrusted in-repo symlink must not redirect the listing outside the worktree
      case SYMLINK -> throw new BadRequestException("Invalid directory path: " + path);
      case FILE, OTHER -> throw new BadRequestException("Not a directory: " + path);
      case DIRECTORY -> {
        // fall through to the listing below
      }
    }
    // The lstat above only vets the final segment; an intermediate symlinked directory (e.g.
    // linkdir/ -> /etc) is transparently followed during path resolution, so confirm the whole path
    // still resolves inside the worktree before find walks it.
    if (!access.resolvesInsideRoot(repoId, worktreeId, path)) {
      throw new BadRequestException("Invalid directory path: " + path);
    }

    List<String> files = new ArrayList<>();
    List<LazyDir> dirs = new ArrayList<>();
    for (WorktreeFileAccess.Entry child : access.list(repoId, worktreeId, path)) {
      switch (child.type()) {
        case FILE -> files.add(child.path());
        case DIRECTORY -> dirs.add(new LazyDir(child.path(), child.childCount()));
        default -> {
          // SYMLINK/OTHER skipped — not followed, not surfaced
        }
      }
    }
    files.sort(Comparator.naturalOrder());
    dirs.sort(Comparator.comparing(LazyDir::path));
    return new Listing(files, dirs);
  }

  /** The active laziness strategy, selected by {@code qits.repositories.file-tree.laziness}. */
  private LazyDirectoryStrategy strategy() {
    return lazyStrategies.stream()
        .filter(s -> s.id().equals(lazinessStrategyId))
        .findFirst()
        .orElseThrow(
            () ->
                new InternalServerErrorException(
                    "Unknown file-tree laziness strategy: " + lazinessStrategyId));
  }

  /**
   * Reads a single file's working-tree content from the container. {@code path} is user-supplied,
   * so it is lexically guarded against {@code ../} traversal; a committed symlink is rejected
   * outright rather than followed (cloned repositories are untrusted and git checks out symlinks).
   * A file that contains NUL bytes or exceeds {@link #MAX_CONTENT_BYTES} is reported as {@code
   * binary} with no content.
   */
  public WorktreeFileContentDto readFile(String repoId, String worktreeId, String path) {
    if (path == null || path.isBlank()) {
      throw new BadRequestException("File path is required");
    }
    validate(repoId, worktreeId);
    requireSafeRelativePath(path);

    WorktreeFileAccess.Entry stat = access.stat(repoId, worktreeId, path);
    switch (stat.type()) {
      case MISSING, DIRECTORY, OTHER -> throw new NotFoundException("File not found: " + path);
      // a symlink committed inside the (untrusted) worktree is never dereferenced
      case SYMLINK -> throw new BadRequestException("Invalid file path: " + path);
      case FILE -> {
        // fall through to the read below
      }
    }
    // The lstat above only vets the final segment; an intermediate symlinked directory (e.g.
    // linkdir/ -> /etc in `linkdir/passwd`) is transparently followed during path resolution, so
    // confirm the whole path still resolves inside the worktree before cat reads it.
    if (!access.resolvesInsideRoot(repoId, worktreeId, path)) {
      throw new BadRequestException("Invalid file path: " + path);
    }
    if (stat.size() > MAX_CONTENT_BYTES) {
      return new WorktreeFileContentDto(path, null, true);
    }

    byte[] bytes = access.read(repoId, worktreeId, path);
    if (isBinary(bytes)) {
      return new WorktreeFileContentDto(path, null, true);
    }
    return new WorktreeFileContentDto(path, new String(bytes, StandardCharsets.UTF_8), false);
  }

  /**
   * Validates the worktree is browsable: the repository row exists, the worktree has an active row,
   * and its container exists (the container holds the {@code /workspace} clone every read runs
   * against).
   */
  private void validate(String repoId, String worktreeId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));
    worktreeRepository
        .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
        .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));
    if (!containers.exists(containers.containerName(worktreeId, repoId))) {
      throw new NotFoundException("Worktree container not found");
    }
  }

  /**
   * Lexically rejects a user-supplied path that is absolute or contains a {@code ..} segment,
   * before it ever reaches the container. Reads run with workdir {@code /workspace} and a relative
   * path, so this guard (plus the outright symlink rejection in the callers) is what keeps a
   * request inside the worktree root.
   */
  private static void requireSafeRelativePath(String path) {
    if (path.startsWith("/") || path.startsWith("\\") || path.indexOf('\0') >= 0) {
      throw new BadRequestException("Invalid file path: " + path);
    }
    for (String segment : path.split("/")) {
      if (segment.equals("..")) {
        throw new BadRequestException("Invalid file path: " + path);
      }
    }
  }

  /** A file is treated as binary when any NUL byte appears in it — the usual git heuristic. */
  private static boolean isBinary(byte[] bytes) {
    for (byte b : bytes) {
      if (b == 0) {
        return true;
      }
    }
    return false;
  }
}
