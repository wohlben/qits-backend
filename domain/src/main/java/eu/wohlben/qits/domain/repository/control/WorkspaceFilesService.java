package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorkspaceFileContentDto;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
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
 * Read-only browsing of a workspace's files for the file-browser UI: the file list (git-aware, so
 * build artifacts and ignored files stay out) and the text content of a single file. Every read
 * runs inside the workspace's container ({@code /workspace}) via {@link WorkspaceFileAccess}, so
 * the browser shows the container's actual live working tree — an agent's uncommitted edits
 * included — rather than a host checkout (there is none). This class owns only orchestration,
 * sorting and path-safety policy; the exec mechanics live behind {@link WorkspaceFileAccess}, and
 * the DTOs it returns are byte-identical to the previous host-path implementation.
 */
@ApplicationScoped
public class WorkspaceFilesService {

  /** Files larger than this are reported as {@code binary} rather than streamed into the viewer. */
  private static final long MAX_CONTENT_BYTES = 2_000_000L;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject WorkspaceService workspaceService;

  @Inject WorkspaceFileAccess access;

  @Inject WorkspaceTreeFingerprint fingerprint;

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
   * One level of a workspace's file tree: eager {@code paths} (files rendered immediately), {@code
   * lazyDirs} (collapsed stubs), and the whole-tree structural {@code generation} token (a hash of
   * the sorted {@code ls-files}) — the same value {@code /detection} stamps, so the client renders
   * the two generation-consistent. Returned for both the root and a single lazy directory.
   */
  public record Listing(List<String> paths, List<LazyDir> lazyDirs, String generation) {}

  /**
   * Lists a workspace level as a {@link Listing}. With no {@code path} this is the root: eager
   * files from {@code git ls-files --cached --others --exclude-standard} (tracked + new untracked,
   * gitignore honoured) plus the directories the active laziness strategy marked as lazy stubs.
   * With a {@code path} it is that one directory's immediate listing (a lazy directory git refuses
   * to walk), so arbitrarily deep lazy nesting resolves through the same endpoint.
   */
  public Listing listFiles(String repoId, String workspaceId, String path) {
    validate(repoId, workspaceId);
    if (path == null || path.isBlank()) {
      return listRoot(repoId, workspaceId);
    }
    return listDirectory(repoId, workspaceId, path);
  }

  /** The eager (non-lazy) tree from the workspace root, with the strategy's lazy dirs alongside. */
  private Listing listRoot(String repoId, String workspaceId) {
    String output =
        access.git(repoId, workspaceId, "ls-files", "--cached", "--others", "--exclude-standard");
    List<String> paths =
        output.lines().filter(line -> !line.isBlank()).distinct().sorted().toList();

    List<LazyDir> lazyDirs =
        strategy().lazyDirectories(repoId, workspaceId, access).stream()
            .map(dir -> new LazyDir(dir, access.childCount(repoId, workspaceId, dir)))
            .toList();
    // The root already holds the whole-tree ls-files, so fingerprint it directly (no second call).
    return new Listing(paths, lazyDirs, WorkspaceTreeFingerprint.of(paths));
  }

  /**
   * Lists one directory a single level deep. Immediate regular files become {@code paths};
   * immediate subdirectories become lazy stubs again (the same laziness applies recursively).
   * Symlinks are skipped rather than followed — a symlink committed inside an untrusted workspace
   * must not be walked through. {@code path} is user-supplied, so it is guarded exactly like a file
   * read.
   */
  private Listing listDirectory(String repoId, String workspaceId, String path) {
    if (path.equals(".git") || path.startsWith(".git/")) {
      throw new BadRequestException("Cannot list the .git directory");
    }
    requireSafeRelativePath(path);
    WorkspaceFileAccess.Entry stat = access.stat(repoId, workspaceId, path);
    switch (stat.type()) {
      case MISSING -> throw new NotFoundException("Directory not found: " + path);
      // an untrusted in-repo symlink must not redirect the listing outside the workspace
      case SYMLINK -> throw new BadRequestException("Invalid directory path: " + path);
      case FILE, OTHER -> throw new BadRequestException("Not a directory: " + path);
      case DIRECTORY -> {
        // fall through to the listing below
      }
    }
    // The lstat above only vets the final segment; an intermediate symlinked directory (e.g.
    // linkdir/ -> /etc) is transparently followed during path resolution, so confirm the whole path
    // still resolves inside the workspace before find walks it.
    if (!access.resolvesInsideRoot(repoId, workspaceId, path)) {
      throw new BadRequestException("Invalid directory path: " + path);
    }

    List<String> files = new ArrayList<>();
    List<LazyDir> dirs = new ArrayList<>();
    for (WorkspaceFileAccess.Entry child : access.list(repoId, workspaceId, path)) {
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
    // A lazy level holds only its own slice, so fingerprint the whole tree separately — the client
    // gates on the same token regardless of which level triggered the fetch.
    return new Listing(files, dirs, fingerprint.compute(repoId, workspaceId));
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
  public WorkspaceFileContentDto readFile(String repoId, String workspaceId, String path) {
    if (path == null || path.isBlank()) {
      throw new BadRequestException("File path is required");
    }
    validate(repoId, workspaceId);
    requireSafeRelativePath(path);

    WorkspaceFileAccess.Entry stat = access.stat(repoId, workspaceId, path);
    switch (stat.type()) {
      case MISSING, DIRECTORY, OTHER -> throw new NotFoundException("File not found: " + path);
      // a symlink committed inside the (untrusted) workspace is never dereferenced
      case SYMLINK -> throw new BadRequestException("Invalid file path: " + path);
      case FILE -> {
        // fall through to the read below
      }
    }
    // The lstat above only vets the final segment; an intermediate symlinked directory (e.g.
    // linkdir/ -> /etc in `linkdir/passwd`) is transparently followed during path resolution, so
    // confirm the whole path still resolves inside the workspace before cat reads it.
    if (!access.resolvesInsideRoot(repoId, workspaceId, path)) {
      throw new BadRequestException("Invalid file path: " + path);
    }
    if (stat.size() > MAX_CONTENT_BYTES) {
      return new WorkspaceFileContentDto(path, null, true);
    }

    byte[] bytes = access.read(repoId, workspaceId, path);
    if (isBinary(bytes)) {
      return new WorkspaceFileContentDto(path, null, true);
    }
    return new WorkspaceFileContentDto(path, new String(bytes, StandardCharsets.UTF_8), false);
  }

  /**
   * Validates the workspace is browsable: the repository row exists, the workspace has an active
   * row, and its container is running — re-provisioning it on demand if the container was lost (the
   * container holds the {@code /workspace} clone every read runs against, and it is a recreatable
   * cache of the durable branch, so a missing one is restored rather than a hard error).
   */
  private void validate(String repoId, String workspaceId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));
    workspaceRepository
        .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
        .orElseThrow(() -> new NotFoundException("Workspace not found: " + workspaceId));
    workspaceService.ensureContainer(repoId, workspaceId);
  }

  /**
   * Lexically rejects a user-supplied path that is absolute or contains a {@code ..} segment,
   * before it ever reaches the container. Reads run with workdir {@code /workspace} and a relative
   * path, so this guard (plus the outright symlink rejection in the callers) is what keeps a
   * request inside the workspace root.
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
