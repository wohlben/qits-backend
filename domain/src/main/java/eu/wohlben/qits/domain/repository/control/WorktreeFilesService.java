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
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Read-only browsing of a worktree's on-disk files for the file-browser UI: the file list
 * (git-aware, so build artifacts and ignored files stay out) and the text content of a single file.
 * Content is read from the working tree — not from git — so uncommitted edits an agent just made
 * are visible.
 */
@ApplicationScoped
public class WorktreeFilesService {

  /** Files larger than this are reported as {@code binary} rather than streamed into the viewer. */
  private static final long MAX_CONTENT_BYTES = 2_000_000L;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorktreeRepository worktreeRepository;

  @Inject GitExecutor git;

  @Inject @Any Instance<LazyDirectoryStrategy> lazyStrategies;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

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
   * With a {@code path} it is that one directory's immediate listing, read straight from the
   * filesystem (a lazy directory git refuses to walk), so arbitrarily deep lazy nesting resolves
   * through the same endpoint.
   */
  public Listing listFiles(String repoId, String worktreeId, String path) {
    Path worktreePath = worktreePath(repoId, worktreeId);
    if (path == null || path.isBlank()) {
      return listRoot(worktreePath);
    }
    return listDirectory(worktreePath, path);
  }

  /** The eager (non-lazy) tree from the worktree root, with the strategy's lazy dirs alongside. */
  private Listing listRoot(Path worktreePath) {
    String output;
    try {
      output =
          git.exec(
              worktreePath.toFile(),
              "git",
              "ls-files",
              "--cached",
              "--others",
              "--exclude-standard");
    } catch (Exception e) {
      throw new InternalServerErrorException("Failed to list worktree files: " + e.getMessage());
    }
    List<String> paths =
        output.lines().filter(line -> !line.isBlank()).distinct().sorted().toList();

    Path root = canonicalRoot(worktreePath);
    List<LazyDir> lazyDirs =
        strategy().lazyDirectories(root, git).stream()
            .map(dir -> new LazyDir(dir, immediateChildCount(root.resolve(dir))))
            .toList();
    return new Listing(paths, lazyDirs);
  }

  /**
   * Lists one directory a single level deep, read directly from the filesystem (git offers nothing
   * inside an ignored directory). Immediate regular files become {@code paths}; immediate
   * subdirectories become lazy stubs again (the same laziness applies recursively). Symlinks are
   * skipped rather than followed — a symlink committed inside an untrusted worktree must not be
   * walked through (see {@link #resolveWithinWorktree}). {@code path} is user-supplied, so it is
   * guarded exactly like a file read.
   */
  private Listing listDirectory(Path worktreePath, String path) {
    if (path.equals(".git") || path.startsWith(".git/")) {
      throw new BadRequestException("Cannot list the .git directory");
    }
    Path root = canonicalRoot(worktreePath);
    Path real = resolveWithinWorktree(root, path);
    if (!Files.isDirectory(real, LinkOption.NOFOLLOW_LINKS)) {
      throw new BadRequestException("Not a directory: " + path);
    }

    List<String> files = new ArrayList<>();
    List<LazyDir> dirs = new ArrayList<>();
    try (Stream<Path> children = Files.list(real)) {
      for (Path child : (Iterable<Path>) children::iterator) {
        String rel = root.relativize(child).toString().replace('\\', '/');
        if (Files.isSymbolicLink(child)) {
          continue; // not followed — a symlink could redirect the listing outside the worktree
        }
        if (Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) {
          dirs.add(new LazyDir(rel, immediateChildCount(child)));
        } else if (Files.isRegularFile(child, LinkOption.NOFOLLOW_LINKS)) {
          files.add(rel);
        }
      }
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to list directory: " + e.getMessage());
    }
    files.sort(Comparator.naturalOrder());
    dirs.sort(Comparator.comparing(LazyDir::path));
    return new Listing(files, dirs);
  }

  /**
   * Immediate-child count of a directory — one cheap listing, never a recursive descendant walk.
   */
  private int immediateChildCount(Path dir) {
    try (Stream<Path> children = Files.list(dir)) {
      return (int) children.count();
    } catch (IOException e) {
      return 0;
    }
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
   * Reads a single file's working-tree content. {@code path} is user-supplied, so it is resolved
   * and checked to stay within the worktree root (no {@code ../} traversal). Symlinks are resolved
   * and re-checked so a link committed inside the worktree can't point the read at a file outside
   * it — cloned repositories are untrusted and git checks out symlinks. A file that contains NUL
   * bytes or exceeds {@link #MAX_CONTENT_BYTES} is reported as {@code binary} with no content.
   */
  public WorktreeFileContentDto readFile(String repoId, String worktreeId, String path) {
    if (path == null || path.isBlank()) {
      throw new BadRequestException("File path is required");
    }
    Path root = canonicalRoot(worktreePath(repoId, worktreeId));
    Path real = resolveWithinWorktree(root, path);
    if (!Files.isRegularFile(real, LinkOption.NOFOLLOW_LINKS)) {
      throw new NotFoundException("File not found: " + path);
    }

    byte[] bytes;
    try {
      if (Files.size(real) > MAX_CONTENT_BYTES) {
        return new WorktreeFileContentDto(path, null, true);
      }
      bytes = Files.readAllBytes(real);
    } catch (IOException e) {
      throw new InternalServerErrorException("Failed to read file: " + e.getMessage());
    }

    if (isBinary(bytes)) {
      return new WorktreeFileContentDto(path, null, true);
    }
    return new WorktreeFileContentDto(path, new String(bytes, StandardCharsets.UTF_8), false);
  }

  /**
   * Resolves a worktree id to its on-disk checkout path, following the repository's data-dir
   * convention ({@code <dataDir>/<repoId>/worktrees/<worktreeId>}), and validates it exists both as
   * an active row and on disk.
   */
  private Path worktreePath(String repoId, String worktreeId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));
    worktreeRepository
        .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
        .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId);
    if (!Files.exists(worktreePath)) {
      throw new NotFoundException("Worktree not found on disk");
    }
    return worktreePath;
  }

  /** Canonicalizes the worktree root (it may live under a symlinked data dir). */
  private Path canonicalRoot(Path worktreePath) {
    try {
      return worktreePath.toRealPath();
    } catch (IOException e) {
      throw new NotFoundException("Worktree not found on disk");
    }
  }

  /**
   * Resolves a user-supplied {@code path} against the canonical worktree {@code root} and proves it
   * stays inside — shared by file reads and directory listings, since {@code path} is untrusted in
   * both. First a lexical guard rejects {@code ..}/absolute escapes; then symlinks along the path
   * are resolved and containment re-checked, so a symlink committed inside the (untrusted) worktree
   * can't redirect the operation to a target outside it. Returns the real, contained path.
   */
  private Path resolveWithinWorktree(Path root, String path) {
    Path resolved = root.resolve(path).normalize();
    if (!resolved.startsWith(root)) {
      throw new BadRequestException("Invalid file path: " + path);
    }
    Path real;
    try {
      real = resolved.toRealPath();
    } catch (IOException e) {
      throw new NotFoundException("File not found: " + path);
    }
    if (!real.startsWith(root)) {
      throw new BadRequestException("Invalid file path: " + path);
    }
    return real;
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
