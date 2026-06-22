package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.InternalServerErrorException;
import jakarta.ws.rs.NotFoundException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class WorktreeService {

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorktreeRepository worktreeRepository;

  @Inject MetadataService metadataService;

  @Inject GitExecutor git;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  public List<WorktreeDto> listWorktrees(String repoId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    return worktreeRepository.findByRepositoryId(repoId).stream()
        .map(
            wt ->
                new WorktreeDto(
                    wt.worktreeId, wt.parent, currentBranchOrNull(repoId, wt.worktreeId)))
        .toList();
  }

  private String currentBranchOrNull(String repoId, String worktreeId) {
    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId);
    if (!Files.exists(worktreePath)) {
      return null;
    }
    try {
      return git.getCurrentBranch(worktreePath);
    } catch (Exception e) {
      return null;
    }
  }

  @Transactional
  public Worktree createWorktree(String repoId, String worktreeId, String parent, String branch) {
    var repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Path originPath = Path.of(dataDir, repoId, "origin");
    if (!Files.exists(originPath)) {
      throw new NotFoundException("Repository origin not found on disk");
    }

    if (worktreeRepository.existsByRepositoryAndWorktreeId(repoId, worktreeId)) {
      throw new BadRequestException("Worktree already exists: " + worktreeId);
    }

    // `parent` is the branch to fork from; `branch` is the new branch the worktree owns.
    // Each worktree gets its own branch so two worktrees never commit to the same branch.
    String parentBranch = (parent == null || parent.isBlank()) ? "master" : parent;
    String newBranch = (branch == null || branch.isBlank()) ? worktreeId : branch;
    // Absolute path: `git worktree add` runs with cwd=origin, so a relative path
    // would be created nested under origin instead of the repo's worktrees dir.
    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId).toAbsolutePath();

    try {
      Files.createDirectories(worktreePath.getParent());
      git.exec(
          originPath.toFile(),
          "git",
          "worktree",
          "add",
          "-b",
          newBranch,
          worktreePath.toString(),
          parentBranch);
    } catch (Exception e) {
      throw new InternalServerErrorException("Git worktree add failed: " + e.getMessage());
    }

    Worktree worktree = new Worktree();
    worktree.worktreeId = worktreeId;
    worktree.repository = repo;
    worktree.parent = parentBranch;
    worktreeRepository.persist(worktree);

    WorktreeMetadata metadata = new WorktreeMetadata();
    metadata.worktreeId = worktreeId;
    metadata.parent = parentBranch;
    metadataService.writeWorktreeMetadata(repoId, metadata);

    return worktree;
  }

  @Transactional
  public MergeResult mergeWorktree(String repoId, String worktreeId, String target) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    worktreeRepository
        .findByRepositoryAndWorktreeId(repoId, worktreeId)
        .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId);
    if (!Files.exists(worktreePath)) {
      throw new NotFoundException("Worktree not found on disk");
    }

    String resolvedTarget = (target == null || target.isBlank()) ? "master" : target;

    // Resolve target to a branch name
    Worktree targetWorktree =
        worktreeRepository.findByRepositoryAndWorktreeId(repoId, resolvedTarget).orElse(null);
    if (targetWorktree != null) {
      Path targetWorktreePath = Path.of(dataDir, repoId, "worktrees", targetWorktree.worktreeId);
      if (Files.exists(targetWorktreePath)) {
        resolvedTarget = git.getCurrentBranch(targetWorktreePath);
      }
    }

    String currentBranch = git.getCurrentBranch(worktreePath);
    Path originPath = Path.of(dataDir, repoId, "origin");

    // Find existing worktree for target branch or create a temp one
    Path mergeCwd = findWorktreePathForBranch(repoId, resolvedTarget);
    boolean isTemp = false;
    if (mergeCwd == null) {
      mergeCwd =
          Path.of(dataDir, repoId, "worktrees", ".tmp-merge-" + System.currentTimeMillis())
              .toAbsolutePath();
      try {
        git.exec(
            originPath.toFile(), "git", "worktree", "add", mergeCwd.toString(), resolvedTarget);
      } catch (Exception e) {
        throw new InternalServerErrorException(
            "Failed to create merge worktree: " + e.getMessage());
      }
      isTemp = true;
    }

    try {
      String output =
          git.exec(
              mergeCwd.toFile(),
              "git",
              "merge",
              currentBranch,
              "-m",
              "Merge " + currentBranch + " into " + resolvedTarget);
      String commitHash = git.exec(mergeCwd.toFile(), "git", "rev-parse", "HEAD").trim();
      boolean hasConflicts = output.toLowerCase().contains("conflict");
      if (isTemp) {
        git.exec(originPath.toFile(), "git", "worktree", "remove", mergeCwd.toString());
      }
      return new MergeResult(commitHash, hasConflicts, output);
    } catch (InternalServerErrorException e) {
      throw e;
    } catch (Exception e) {
      if (isTemp) {
        try {
          git.exec(originPath.toFile(), "git", "worktree", "remove", "-f", mergeCwd.toString());
        } catch (Exception ignored) {
        }
      }
      throw new InternalServerErrorException("Git merge failed: " + e.getMessage());
    }
  }

  @Transactional
  public void discardWorktree(String repoId, String worktreeId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Worktree worktree =
        worktreeRepository
            .findByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId);
    Path originPath = Path.of(dataDir, repoId, "origin");

    try {
      String branch = git.getCurrentBranch(worktreePath);

      if (Files.exists(worktreePath)) {
        git.exec(originPath.toFile(), "git", "worktree", "remove", "-f", worktreePath.toString());
      }

      try {
        git.exec(originPath.toFile(), "git", "branch", "-D", branch);
      } catch (Exception ignored) {
        // branch may already be gone
      }

      worktreeRepository.delete(worktree);
      metadataService.deleteWorktreeMetadata(repoId, worktreeId);
    } catch (InternalServerErrorException e) {
      throw e;
    } catch (Exception e) {
      throw new InternalServerErrorException("Git discard failed: " + e.getMessage());
    }
  }

  private Path findWorktreePathForBranch(String repoId, String branch) {
    for (Worktree wt : worktreeRepository.findByRepositoryId(repoId)) {
      Path p = Path.of(dataDir, repoId, "worktrees", wt.worktreeId);
      if (Files.exists(p)) {
        try {
          String b = git.getCurrentBranch(p);
          if (b.equals(branch)) {
            return p;
          }
        } catch (Exception ignored) {
        }
      }
    }
    return null;
  }

  public record MergeResult(String commitHash, boolean hasConflicts, String output) {}
}
