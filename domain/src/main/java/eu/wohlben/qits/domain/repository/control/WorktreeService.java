package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
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

    Path originPath = Path.of(dataDir, repoId, "origin");
    return worktreeRepository.findByRepositoryId(repoId).stream()
        .map(
            wt -> {
              String branch = currentBranchOrNull(repoId, wt.worktreeId);
              AheadBehind ab = aheadBehind(originPath, wt.parent, branch);
              return new WorktreeDto(wt.worktreeId, wt.parent, branch, ab.ahead(), ab.behind());
            })
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

  /**
   * Counts how far {@code branch} is ahead of and behind its {@code parent} branch. Runs in the
   * bare origin, which holds every worktree branch as a ref. Returns {@code (0, 0)} when the two
   * names are the same or either is missing, and {@code (null, null)} if git can't resolve a ref.
   */
  private AheadBehind aheadBehind(Path originPath, String parent, String branch) {
    if (parent == null
        || branch == null
        || parent.isBlank()
        || branch.isBlank()
        || parent.equals(branch)
        || !Files.exists(originPath)) {
      return new AheadBehind(0, 0);
    }
    try {
      // `--left-right --count A...B` prints "<behind>\t<ahead>": commits in A not B, then B not A.
      String out =
          git.exec(
                  originPath.toFile(),
                  "git",
                  "rev-list",
                  "--left-right",
                  "--count",
                  parent + "..." + branch)
              .trim();
      String[] parts = out.split("\\s+");
      if (parts.length != 2) {
        return new AheadBehind(null, null);
      }
      return new AheadBehind(Integer.parseInt(parts[1]), Integer.parseInt(parts[0]));
    } catch (Exception e) {
      return new AheadBehind(null, null);
    }
  }

  private record AheadBehind(Integer ahead, Integer behind) {}

  @Transactional
  public Worktree createWorktree(String repoId, String worktreeId, String parent, String branch) {
    var repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    // `worktreeId` becomes a path segment under the repo's worktrees dir, so it must be a strict
    // slug: no slashes/dots/dashes-leading that could traverse out of the dir or smuggle a git
    // flag.
    if (!worktreeId.matches("[A-Za-z0-9_-]{1,64}") || worktreeId.startsWith("-")) {
      throw new BadRequestException("Invalid worktree id: " + worktreeId);
    }

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
    // Both are user-supplied and passed to git: reject dash-leading names so they can't be smuggled
    // in as flags (argv flag injection).
    if (parentBranch.startsWith("-") || newBranch.startsWith("-")) {
      throw new BadRequestException("Invalid branch name");
    }
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
          "--end-of-options",
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
    return mergeIntoTarget(repoId, currentBranch, resolvedTarget);
  }

  /**
   * Integrates an arbitrary branch into a target branch, defaulting to the repository's configured
   * main branch when {@code target} is blank. Unlike {@link #mergeWorktree}, the source needs no
   * worktree of its own — its branch ref is merged into the target's worktree (a temporary one is
   * created and removed when the target isn't checked out anywhere).
   */
  public MergeResult mergeBranch(String repoId, String source, String target) {
    // `source`/`target` are user-supplied: reject blank or dash-leading names so a value like
    // "-D" can't be smuggled to git as a flag (argv flag injection).
    if (source == null || source.isBlank() || source.startsWith("-")) {
      throw new BadRequestException("Invalid source branch: " + source);
    }

    Repository repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    String resolvedTarget = (target == null || target.isBlank()) ? repo.mainBranch : target;
    if (resolvedTarget == null || resolvedTarget.isBlank() || resolvedTarget.startsWith("-")) {
      throw new BadRequestException("Invalid target branch: " + target);
    }
    if (source.equals(resolvedTarget)) {
      throw new BadRequestException("Cannot integrate '" + source + "' into itself");
    }

    return mergeIntoTarget(repoId, source, resolvedTarget);
  }

  /**
   * Merges {@code sourceBranch} into {@code resolvedTarget}: runs {@code git merge} inside the
   * target branch's worktree, creating (and afterwards removing) a temporary worktree when the
   * target isn't already checked out. Shared by worktree and branch integration.
   */
  private MergeResult mergeIntoTarget(String repoId, String sourceBranch, String resolvedTarget) {
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
              sourceBranch,
              "-m",
              "Merge " + sourceBranch + " into " + resolvedTarget);
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

  /**
   * Fast-forwards a worktree's branch to the latest commit of its parent branch. Runs {@code git
   * merge --ff-only} inside the worktree so the ref, index and working tree all advance together;
   * the {@code --ff-only} flag refuses (and reports an error) when the branch has diverged or the
   * working tree is dirty, which surfaces as a 400.
   */
  public String fastForwardWorktree(String repoId, String worktreeId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Worktree worktree =
        worktreeRepository
            .findByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId);
    if (!Files.exists(worktreePath)) {
      throw new NotFoundException("Worktree not found on disk");
    }

    String parent = worktree.parent;
    if (parent == null || parent.isBlank()) {
      throw new BadRequestException(
          "Worktree '" + worktreeId + "' has no parent to fast-forward to");
    }

    try {
      return git.exec(worktreePath.toFile(), "git", "merge", "--ff-only", parent);
    } catch (Exception e) {
      throw new BadRequestException(
          "Cannot fast-forward worktree '"
              + worktreeId
              + "' to '"
              + parent
              + "': "
              + e.getMessage());
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
