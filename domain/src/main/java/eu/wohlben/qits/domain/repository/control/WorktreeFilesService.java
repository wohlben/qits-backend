package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorktreeFileContentDto;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
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

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  /**
   * Lists the worktree's files as paths relative to its root, sorted. Uses {@code git ls-files
   * --cached --others --exclude-standard} so the result is tracked files plus new untracked ones,
   * while honouring {@code .gitignore} — keeping {@code .git}, {@code node_modules} and build
   * output out of the tree.
   */
  public List<String> listFiles(String repoId, String worktreeId) {
    Path worktreePath = worktreePath(repoId, worktreeId);
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
    return output.lines().filter(line -> !line.isBlank()).distinct().sorted().toList();
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
    Path worktreePath = worktreePath(repoId, worktreeId);
    Path root;
    try {
      // Canonicalize the root itself (it may live under a symlinked data dir).
      root = worktreePath.toRealPath();
    } catch (IOException e) {
      throw new NotFoundException("Worktree not found on disk");
    }

    // Lexical guard first: reject `..`/absolute escapes before touching the filesystem.
    Path resolved = root.resolve(path).normalize();
    if (!resolved.startsWith(root)) {
      throw new BadRequestException("Invalid file path: " + path);
    }

    // Resolve any symlinks along the path and re-check containment, so a symlink inside the
    // worktree can't redirect the read to a target outside it (path traversal via symlink).
    Path real;
    try {
      real = resolved.toRealPath();
    } catch (IOException e) {
      throw new NotFoundException("File not found: " + path);
    }
    if (!real.startsWith(root)) {
      throw new BadRequestException("Invalid file path: " + path);
    }
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
