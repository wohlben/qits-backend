package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.entity.WorktreeEvent;
import eu.wohlben.qits.domain.repository.entity.WorktreeEventType;
import eu.wohlben.qits.domain.repository.entity.WorktreeRuntimeStatus;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeEventRepository;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import org.eclipse.microprofile.config.inject.ConfigProperty;

@ApplicationScoped
public class WorktreeService {

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorktreeRepository worktreeRepository;

  @Inject WorktreeEventRepository worktreeEventRepository;

  @Inject MetadataService metadataService;

  @Inject GitExecutor git;

  @Inject ContainerRuntime containers;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  @ConfigProperty(name = "qits.workspace.git-host", defaultValue = "host.docker.internal")
  String gitHost;

  @ConfigProperty(name = "qits.workspace.qits-port", defaultValue = "8080")
  String qitsPort;

  /** The URL a worktree container clones/pushes its branch over (the in-process JGit host). */
  private String cloneUrl(String repoId) {
    return "http://" + gitHost + ":" + qitsPort + "/git/" + repoId;
  }

  /**
   * Runs a git command inside a worktree's container under {@code /workspace}, throwing on a
   * non-zero exit. The container-side counterpart of {@code git.exec(worktreePath, …)} now that the
   * checkout lives in the container rather than on the host.
   */
  private String containerGit(String repoId, String worktreeId, String... gitArgs) {
    String container = containers.containerName(worktreeId, repoId);
    String[] argv = new String[gitArgs.length + 1];
    argv[0] = "git";
    System.arraycopy(gitArgs, 0, argv, 1, gitArgs.length);
    ContainerRuntime.ExecResult result =
        containers.exec(container, "/workspace", java.util.Map.of(), argv);
    if (result.exitCode() != 0) {
      throw new InternalServerErrorException(
          "Container git failed ["
              + result.exitCode()
              + "]: "
              + String.join(" ", argv)
              + "\n"
              + result.output());
    }
    return result.output();
  }

  /**
   * Materializes a worktree as a branch + container: optionally creates {@code branch} in the bare
   * origin (from {@code parentBranch}), runs the container, then clones {@code branch} into its
   * {@code /workspace} and sets the {@code qits@local} commit identity. Rolls back a freshly
   * created branch ref and the container if a later step fails, so a retry with the same id can
   * succeed.
   */
  private void createContainerWorktree(
      String repoId,
      String worktreeId,
      String branch,
      String parentBranch,
      Path originPath,
      boolean createBranchRef) {
    if (createBranchRef) {
      try {
        git.exec(originPath.toFile(), "git", "branch", "--end-of-options", branch, parentBranch);
      } catch (Exception e) {
        throw new InternalServerErrorException("Failed to create branch: " + e.getMessage());
      }
    }

    String container;
    try {
      container = containers.run(repoId, worktreeId, branch, parentBranch);
    } catch (RuntimeException e) {
      rollbackBranch(createBranchRef, originPath, branch);
      throw e;
    }

    ContainerRuntime.ExecResult clone =
        containers.exec(
            container,
            null,
            java.util.Map.of(),
            "git",
            "clone",
            "--branch",
            branch,
            cloneUrl(repoId),
            "/workspace");
    if (clone.exitCode() != 0) {
      containers.rm(container);
      rollbackBranch(createBranchRef, originPath, branch);
      throw new InternalServerErrorException("Clone into container failed: " + clone.output());
    }
    // Commit identity matches the one mergeIntoTarget/updateWorktreeFromParent use host-side.
    containers.exec(
        container, "/workspace", java.util.Map.of(), "git", "config", "user.email", "qits@local");
    containers.exec(
        container, "/workspace", java.util.Map.of(), "git", "config", "user.name", "qits");
  }

  private void rollbackBranch(boolean created, Path originPath, String branch) {
    if (!created) {
      return;
    }
    try {
      git.exec(originPath.toFile(), "git", "branch", "-D", "--", branch);
    } catch (Exception ignored) {
      // best effort — the branch may not have been created
    }
  }

  /** Appends a history event to a worktree's timeline. */
  private void recordEvent(
      Worktree worktree, WorktreeEventType type, String branch, String target, String commit) {
    worktreeEventRepository.persist(
        WorktreeEvent.builder()
            .worktree(worktree)
            .type(type)
            .branch(branch)
            .parent(worktree.parent)
            .target(target)
            .commit(commit)
            .at(Instant.now())
            .build());
  }

  public List<WorktreeDto> listWorktrees(String repoId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Path originPath = Path.of(dataDir, repoId, "origin");
    // Live container set (one docker ps), so RUNNING stays accurate even when docker state changed
    // out-of-band; the persisted column carries the STOPPED/PROVISIONING/FAILED signal otherwise.
    Set<String> runningIds =
        containers.listWorktreeContainers(repoId).stream()
            .map(ContainerRuntime.ContainerInfo::worktreeId)
            .collect(Collectors.toSet());
    // The branch tree shows only live worktrees; resolved ones live in the history view.
    return worktreeRepository.findActiveByRepositoryId(repoId).stream()
        .map(
            wt -> {
              String branch = wt.branch;
              AheadBehind ab = aheadBehind(originPath, wt.parent, branch);
              // Only diverged branches (both ahead and behind) can't fast-forward and so risk a
              // conflict; everything else integrates cleanly, so skip the extra merge-tree probe.
              boolean conflicts =
                  ab.ahead() != null
                      && ab.behind() != null
                      && ab.ahead() > 0
                      && ab.behind() > 0
                      && wouldConflict(originPath, wt.parent, branch);
              WorktreeRuntimeStatus runtime =
                  runningIds.contains(wt.worktreeId)
                      ? WorktreeRuntimeStatus.RUNNING
                      : wt.runtimeStatus == WorktreeRuntimeStatus.RUNNING
                          ? WorktreeRuntimeStatus.STOPPED
                          : wt.runtimeStatus;
              return new WorktreeDto(
                  wt.worktreeId,
                  wt.parent,
                  branch,
                  ab.ahead(),
                  ab.behind(),
                  conflicts,
                  wt.status,
                  runtime,
                  wt.runtimeError,
                  wt.preamble,
                  wt.result,
                  wt.resolvedAt);
            })
        .toList();
  }

  /**
   * Whether {@code branch} — worktree-backed or plain — can be removed with no data loss: it is not
   * its own parent (the main branch can't be cleaned up), has no unmerged commits ({@code ahead ==
   * 0} against its parent), a clean working tree when worktree-backed, and no other worktree forks
   * from it. A plain branch's parent is the repository's main branch; a worktree's is its fork
   * point. This is the single criterion the UI, the cleanup endpoint and post-integrate cleanup all
   * use.
   */
  public boolean canCleanupBranch(
      String repoId, Path originPath, String branch, String mainBranch) {
    if (branch == null || branch.isBlank() || branch.startsWith("-")) {
      return false;
    }
    Worktree wt = findWorktreeByBranch(repoId, branch);
    String parent =
        (wt != null && wt.parent != null && !wt.parent.isBlank()) ? wt.parent : mainBranch;
    // No usable parent, or the branch *is* its parent (e.g. main): nothing to merge into, never
    // safe.
    if (parent == null || parent.isBlank() || parent.equals(branch)) {
      return false;
    }
    // ahead == null means git couldn't compare; ahead > 0 means commits not yet in the parent.
    Integer ahead = aheadBehind(originPath, parent, branch).ahead();
    if (ahead == null || ahead != 0) {
      return false;
    }
    if (wt != null) {
      // The working tree lives in the container; a dirty tree or unpushed commits (which the
      // origin-side ahead/behind above cannot see) both mean cleanup could destroy work.
      if (!isWorktreeClean(repoId, wt) || !isFullyPushed(repoId, originPath, wt)) {
        return false;
      }
    }
    return !hasChildren(repoId, branch);
  }

  /**
   * Whether the container's HEAD equals the branch's ref in the origin — i.e. every commit made
   * inside the container has been pushed. The origin-side ahead/behind can't see container-local
   * commits, so without this a "safe" cleanup could delete unpushed work. A missing container means
   * nothing is left to lose, so treat it as pushed.
   */
  private boolean isFullyPushed(String repoId, Path originPath, Worktree wt) {
    String container = containers.containerName(wt.worktreeId, repoId);
    if (!containers.exists(container)) {
      return true;
    }
    if (wt.branch == null || wt.branch.isBlank()) {
      return true;
    }
    ContainerRuntime.ExecResult head =
        containers.exec(container, "/workspace", java.util.Map.of(), "git", "rev-parse", "HEAD");
    if (head.exitCode() != 0) {
      return false; // unknown container state — never delete blindly
    }
    try {
      String originSha =
          git.exec(originPath.toFile(), "git", "rev-parse", "refs/heads/" + wt.branch).trim();
      return head.output().trim().equals(originSha);
    } catch (Exception e) {
      return false;
    }
  }

  /** The parent a branch is compared against and how far it is ahead/behind it. */
  public record BranchSummary(String parent, Integer ahead, Integer behind) {}

  /**
   * Resolves a branch's parent — its worktree's fork point when worktree-backed, otherwise the
   * repository's {@code mainBranch} — and how far it is ahead of and behind that parent. Returns a
   * {@code null} parent (and zero counts) for the main branch itself or when no parent resolves.
   * Used to drive the branch tree's ahead/behind connector and commits popover for every branch,
   * including those without a worktree.
   */
  public BranchSummary summarize(String repoId, Path originPath, String branch, String mainBranch) {
    if (branch == null || branch.isBlank() || branch.startsWith("-")) {
      return new BranchSummary(null, 0, 0);
    }
    Worktree wt = findWorktreeByBranch(repoId, branch);
    String parent =
        (wt != null && wt.parent != null && !wt.parent.isBlank()) ? wt.parent : mainBranch;
    if (parent == null || parent.isBlank() || parent.equals(branch)) {
      return new BranchSummary(null, 0, 0);
    }
    AheadBehind ab = aheadBehind(originPath, parent, branch);
    return new BranchSummary(parent, ab.ahead(), ab.behind());
  }

  /** True when the worktree container's working tree has no staged or unstaged changes. */
  private boolean isWorktreeClean(String repoId, Worktree wt) {
    String container = containers.containerName(wt.worktreeId, repoId);
    if (!containers.exists(container)) {
      return false; // no container — treat as not clean so we never delete blindly
    }
    ContainerRuntime.ExecResult status =
        containers.exec(
            container, "/workspace", java.util.Map.of(), "git", "status", "--porcelain");
    return status.exitCode() == 0 && status.output().isBlank();
  }

  /** True when another worktree forks from {@code branch} (i.e. lists it as its parent). */
  private boolean hasChildren(String repoId, String branch) {
    for (Worktree other : worktreeRepository.findActiveByRepositoryId(repoId)) {
      if (branch.equals(other.parent)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The on-disk path of a host worktree checked out on {@code branch}, if any. With workspace
   * containers there are no host checkouts (each branch lives in its container), so this is always
   * empty — the sync code then updates the bare origin ref directly rather than a checked-out
   * worktree. Kept as the seam so pull stays branch-aware if host worktrees ever return.
   */
  public Optional<Path> worktreePathForBranch(String repoId, String branch) {
    return Optional.empty();
  }

  /** The worktree that owns {@code branch}, or null when none matches. */
  private Worktree findWorktreeByBranch(String repoId, String branch) {
    if (branch == null) {
      return null;
    }
    for (Worktree wt : worktreeRepository.findActiveByRepositoryId(repoId)) {
      if (branch.equals(wt.branch)) {
        return wt;
      }
    }
    return null;
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

  /**
   * Whether merging {@code parent} into {@code branch} would produce conflicts, decided by a real
   * three-way merge in the object store via {@code git merge-tree --write-tree} (no working tree
   * touched). It exits 0 when the merge is clean and 1 when it conflicts; any other outcome (error,
   * unresolvable ref) is treated as "no conflict" so we never raise a false warning. Runs in the
   * bare origin, which holds every branch ref.
   */
  private boolean wouldConflict(Path originPath, String parent, String branch) {
    if (parent == null
        || branch == null
        || parent.isBlank()
        || branch.isBlank()
        || parent.equals(branch)
        || parent.startsWith("-")
        || branch.startsWith("-")
        || !Files.exists(originPath)) {
      return false;
    }
    try {
      GitExecutor.ExecResult result =
          git.execAllowNonZero(
              originPath.toFile(), "git", "merge-tree", "--write-tree", branch, parent);
      return result.exitCode() == 1;
    } catch (Exception e) {
      return false;
    }
  }

  public Worktree createWorktree(String repoId, String worktreeId, String parent, String branch) {
    return createWorktree(repoId, worktreeId, parent, branch, null);
  }

  @Transactional
  public Worktree createWorktree(
      String repoId, String worktreeId, String parent, String branch, String preamble) {
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

    // Resolved rows linger (soft delete), so only an ACTIVE worktree blocks the id — a resolved one
    // can be reused.
    if (worktreeRepository.existsActiveByRepositoryAndWorktreeId(repoId, worktreeId)) {
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

    // 1. Create the branch ref host-side in the bare origin so ahead/behind and the merge-tree
    //    conflict probe (both run against origin refs) work from the first second.
    // 2. Run the worktree's container.
    // 3. Clone the new branch into the container's /workspace and set its commit identity.
    createContainerWorktree(repoId, worktreeId, newBranch, parentBranch, originPath, true);

    Worktree worktree = new Worktree();
    worktree.worktreeId = worktreeId;
    worktree.repository = repo;
    worktree.parent = parentBranch;
    worktree.branch = newBranch;
    worktree.status = WorktreeStatus.ACTIVE;
    worktree.runtimeStatus = WorktreeRuntimeStatus.RUNNING;
    worktree.preamble = preamble;
    worktreeRepository.persist(worktree);
    recordEvent(worktree, WorktreeEventType.CREATED, newBranch, parentBranch, null);

    WorktreeMetadata metadata = new WorktreeMetadata();
    metadata.worktreeId = worktreeId;
    metadata.parent = parentBranch;
    metadataService.writeWorktreeMetadata(repoId, metadata);

    return worktree;
  }

  /**
   * Creates the default worktree for a repository's main branch: a checkout of the
   * <em>existing</em> main branch (not a fork of a new branch), so working in it commits directly
   * to main. The worktree id is the branch name as a slug; it has no parent, since the main branch
   * is the root of the branch tree. Idempotent: returns the existing worktree if one with the
   * derived id is already present. Called by {@link RepositoryService} so every freshly added
   * repository starts with its main branch workable.
   */
  @Transactional
  public Worktree createMainWorktree(String repoId, String branch) {
    var repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));
    if (branch == null || branch.isBlank() || branch.startsWith("-")) {
      throw new BadRequestException("Invalid main branch: " + branch);
    }
    String worktreeId = toWorktreeSlug(branch);

    Path originPath = Path.of(dataDir, repoId, "origin");
    if (!Files.exists(originPath)) {
      throw new NotFoundException("Repository origin not found on disk");
    }
    if (worktreeRepository.existsActiveByRepositoryAndWorktreeId(repoId, worktreeId)) {
      return worktreeRepository
          .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
          .orElseThrow();
    }

    // No branch-create: check out the existing main branch rather than fork a new one off it.
    createContainerWorktree(repoId, worktreeId, branch, null, originPath, false);

    Worktree worktree = new Worktree();
    worktree.worktreeId = worktreeId;
    worktree.repository = repo;
    worktree.parent = null; // the main branch is the tree root — it has no fork point
    worktree.branch = branch;
    worktree.status = WorktreeStatus.ACTIVE;
    worktree.runtimeStatus = WorktreeRuntimeStatus.RUNNING;
    worktreeRepository.persist(worktree);
    recordEvent(worktree, WorktreeEventType.CREATED, branch, null, null);

    WorktreeMetadata metadata = new WorktreeMetadata();
    metadata.worktreeId = worktreeId;
    metadata.parent = null;
    metadataService.writeWorktreeMetadata(repoId, metadata);

    return worktree;
  }

  /**
   * Sanitizes a branch name into a worktree-id slug ([A-Za-z0-9_-], ≤64 chars, not dash-leading).
   */
  private static String toWorktreeSlug(String branch) {
    String slug = branch.replaceAll("[^A-Za-z0-9_-]", "-");
    if (slug.length() > 64) {
      slug = slug.substring(0, 64);
    }
    if (slug.isBlank() || slug.startsWith("-")) {
      slug = "main";
    }
    return slug;
  }

  private record BranchParent(String branch, String parent) {}

  /**
   * Guarantees a running container for an ACTIVE worktree whose branch still exists, provisioning
   * one on demand — the container is a recreatable cache of the durable branch, so losing it is a
   * non-event. Idempotent:
   *
   * <ul>
   *   <li>container already running → stamp {@code RUNNING}, no-op. A live container is
   *       <em>never</em> re-cloned over, so unpushed {@code /workspace} commits are safe.
   *   <li>container absent but the branch ref survives in origin → re-materialize a fresh container
   *       from that branch ({@code createBranchRef=false}, the {@link #createMainWorktree} path).
   *   <li>branch ref gone from origin → the work no longer exists anywhere: the worktree is
   *       ABANDONED here (now the <em>only</em> path to abandonment) and a 404 is thrown.
   * </ul>
   *
   * <p><strong>Loss window:</strong> recreation restores <em>origin</em> state only. Commits made
   * in a container but never pushed die with it; the live-container guard protects the graceful
   * case, but an unexpected container death is still lossy (see {@link #stopContainer} for the
   * lossless stop). Not {@code @Transactional}: each status transition commits in its own
   * transaction so a FAILED/ABANDONED outcome is persisted even though the method then throws, and
   * so it is safe to call from non-request threads (like {@code CommandService.prepare}).
   */
  public void ensureContainer(String repoId, String worktreeId) {
    String container = containers.containerName(worktreeId, repoId);

    // Load branch/parent and short-circuit a live container, in its own transaction.
    BranchParent snapshot =
        QuarkusTransaction.requiringNew()
            .call(
                () -> {
                  Worktree wt =
                      worktreeRepository
                          .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
                          .orElseThrow(
                              () -> new NotFoundException("Worktree not found: " + worktreeId));
                  if (containers.exists(container)) {
                    wt.runtimeStatus = WorktreeRuntimeStatus.RUNNING;
                    wt.runtimeError = null;
                    return null; // already running — nothing to provision
                  }
                  return new BranchParent(wt.branch, wt.parent);
                });
    if (snapshot == null) {
      return;
    }

    Path originPath = Path.of(dataDir, repoId, "origin");
    if (snapshot.branch() == null
        || snapshot.branch().isBlank()
        || !branchExists(originPath, snapshot.branch())) {
      // The durable branch is gone: this is genuine death, so abandon (persisted before we throw).
      QuarkusTransaction.requiringNew()
          .run(
              () -> {
                Worktree wt =
                    worktreeRepository
                        .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
                        .orElseThrow(
                            () -> new NotFoundException("Worktree not found: " + worktreeId));
                wt.status = WorktreeStatus.ABANDONED;
                wt.resolvedAt = Instant.now();
                wt.runtimeStatus = WorktreeRuntimeStatus.STOPPED;
                recordEvent(wt, WorktreeEventType.ABANDONED, wt.branch, null, null);
              });
      throw new NotFoundException(
          "Worktree '" + worktreeId + "' has no branch to recreate from; abandoned");
    }

    QuarkusTransaction.requiringNew()
        .run(() -> markRuntime(repoId, worktreeId, WorktreeRuntimeStatus.PROVISIONING, null));
    try {
      createContainerWorktree(
          repoId, worktreeId, snapshot.branch(), snapshot.parent(), originPath, false);
      QuarkusTransaction.requiringNew()
          .run(() -> markRuntime(repoId, worktreeId, WorktreeRuntimeStatus.RUNNING, null));
    } catch (RuntimeException e) {
      QuarkusTransaction.requiringNew()
          .run(
              () ->
                  markRuntime(
                      repoId, worktreeId, WorktreeRuntimeStatus.FAILED, truncate(e.getMessage())));
      throw e;
    }
  }

  private void markRuntime(
      String repoId, String worktreeId, WorktreeRuntimeStatus status, String error) {
    worktreeRepository
        .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
        .ifPresent(
            wt -> {
              wt.runtimeStatus = status;
              wt.runtimeError = error;
            });
  }

  private static String truncate(String s) {
    if (s == null) {
      return null;
    }
    return s.length() <= 2000 ? s : s.substring(0, 2000);
  }

  /** Whether {@code branch} still exists as a ref in the given repo's bare origin. */
  public boolean branchExists(String repoId, String branch) {
    return branchExists(Path.of(dataDir, repoId, "origin"), branch);
  }

  /** Whether {@code branch} still exists as a ref in the bare origin at {@code originPath}. */
  private boolean branchExists(Path originPath, String branch) {
    if (branch == null || branch.isBlank() || branch.startsWith("-") || !Files.exists(originPath)) {
      return false;
    }
    try {
      GitExecutor.ExecResult r =
          git.execAllowNonZero(
              originPath.toFile(),
              "git",
              "rev-parse",
              "--verify",
              "--quiet",
              "refs/heads/" + branch);
      return r.exitCode() == 0;
    } catch (Exception e) {
      return false;
    }
  }

  /**
   * Best-effort push of a worktree's branch to origin from inside its container (no-op if absent).
   */
  private void pushBranch(String repoId, String worktreeId, String branch) {
    String container = containers.containerName(worktreeId, repoId);
    if (branch == null || branch.isBlank() || !containers.exists(container)) {
      return;
    }
    try {
      containers.exec(container, "/workspace", java.util.Map.of(), "git", "push", "origin", branch);
    } catch (RuntimeException ignored) {
      // best effort — a failed push must not block the stop it guards
    }
  }

  /**
   * Gracefully stops a worktree's container: pushes its branch to origin first (so committed work
   * is durable), removes the container, and marks the worktree {@code STOPPED} while leaving it
   * ACTIVE. The container is re-provisioned on next access via {@link #ensureContainer}. This is
   * the lossless counterpart to an unexpected container death — the one path that guarantees
   * unpushed commits are preserved before the container goes away.
   */
  @Transactional
  public void stopContainer(String repoId, String worktreeId) {
    Worktree worktree =
        worktreeRepository
            .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));
    pushBranch(repoId, worktreeId, worktree.branch);
    containers.rm(containers.containerName(worktreeId, repoId));
    worktree.runtimeStatus = WorktreeRuntimeStatus.STOPPED;
  }

  @Transactional
  public MergeResult mergeWorktree(String repoId, String worktreeId, String target) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Worktree worktree =
        worktreeRepository
            .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    String resolvedTarget = (target == null || target.isBlank()) ? "master" : target;

    // Resolve a target given as a worktree id to the branch that worktree owns.
    Worktree targetWorktree =
        worktreeRepository.findActiveByRepositoryAndWorktreeId(repoId, resolvedTarget).orElse(null);
    if (targetWorktree != null && targetWorktree.branch != null) {
      resolvedTarget = targetWorktree.branch;
    }

    String currentBranch = worktree.branch;
    // Integration merges origin refs (in a temp host worktree); the container may hold unpushed
    // commits, so push the source branch first or the merge would miss them.
    containerGit(repoId, worktreeId, "push", "origin", currentBranch);
    MergeResult result = mergeIntoTarget(repoId, currentBranch, resolvedTarget);
    if (!result.hasConflicts()) {
      recordEvent(
          worktree, WorktreeEventType.MERGED, currentBranch, resolvedTarget, result.commitHash());
    }
    return result;
  }

  /**
   * Integrates an arbitrary branch into a target branch, defaulting to the repository's configured
   * main branch when {@code target} is blank. Unlike {@link #mergeWorktree}, the source needs no
   * worktree of its own — its branch ref is merged into the target's worktree (a temporary one is
   * created and removed when the target isn't checked out anywhere).
   */
  public MergeResult mergeBranch(String repoId, String source, String target) {
    return mergeBranch(repoId, source, target, null);
  }

  @Transactional
  public MergeResult mergeBranch(String repoId, String source, String target, String result) {
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

    MergeResult merged = mergeIntoTarget(repoId, source, resolvedTarget);

    // After a clean integration the source branch's commits live in the target, so when the source
    // is now safe to remove (fully merged, clean if worktree-backed, no dependents) we clean it up
    // —
    // whether it is a worktree or a plain branch.
    boolean cleanedUp = false;
    if (!merged.hasConflicts()) {
      Path originPath = Path.of(dataDir, repoId, "origin");
      if (canCleanupBranch(repoId, originPath, source, repo.mainBranch)) {
        doCleanupBranch(repoId, source, result);
        cleanedUp = true;
      }
    }

    return new MergeResult(merged.commitHash(), merged.hasConflicts(), merged.output(), cleanedUp);
  }

  /**
   * Removes a branch (and its worktree, if any) only when it is safe to do so — fully merged, clean
   * working tree when worktree-backed, no dependent worktrees (see {@link #canCleanupBranch}).
   * Because the UI performs this without a confirmation, the safety is enforced here: an ineligible
   * branch yields a 400 and is left untouched.
   */
  public void cleanupBranch(String repoId, String branch) {
    cleanupBranch(repoId, branch, null);
  }

  @Transactional
  public void cleanupBranch(String repoId, String branch, String result) {
    Repository repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Path originPath = Path.of(dataDir, repoId, "origin");
    if (!canCleanupBranch(repoId, originPath, branch, repo.mainBranch)) {
      throw new BadRequestException(
          "Branch '"
              + branch
              + "' cannot be cleaned up: it has uncommitted changes, unmerged commits, or dependent"
              + " worktrees");
    }

    doCleanupBranch(repoId, branch, result);
  }

  /**
   * Deletes a branch: resolves its worktree as INTEGRATED when one is checked out (reusing the
   * discard mechanics), otherwise just deletes the bare branch ref. Callers gate on {@link
   * #canCleanupBranch}.
   */
  private void doCleanupBranch(String repoId, String branch, String result) {
    Worktree wt = findWorktreeByBranch(repoId, branch);
    if (wt != null) {
      doDiscard(repoId, wt, WorktreeStatus.INTEGRATED, result);
      return;
    }
    Path originPath = Path.of(dataDir, repoId, "origin");
    try {
      git.exec(originPath.toFile(), "git", "branch", "-D", branch);
    } catch (Exception e) {
      throw new InternalServerErrorException(
          "Failed to delete branch '" + branch + "': " + e.getMessage());
    }
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
        // The worktrees dir no longer holds host checkouts (they are containers now); ensure it
        // exists so the throwaway merge worktree can be created under it.
        Files.createDirectories(mergeCwd.getParent());
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
      return new MergeResult(commitHash, hasConflicts, output, false);
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
            .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    String parent = worktree.parent;
    if (parent == null || parent.isBlank()) {
      throw new BadRequestException(
          "Worktree '" + worktreeId + "' has no parent to fast-forward to");
    }
    if (parent.startsWith("-")) {
      throw new BadRequestException("Invalid parent branch");
    }

    // Inside the container: fetch, first fast-forward the container's own branch to origin's ref
    // (it may have advanced out-of-band, e.g. a host-side integration into it), then fast-forward
    // onto the parent and push. --ff-only refuses (400) on divergence or a dirty tree — so a branch
    // that diverged from its parent is correctly rejected even though the container was stale.
    ensureContainer(repoId, worktreeId); // re-provision a lost container from the branch first
    try {
      containerGit(repoId, worktreeId, "fetch", "origin");
      containerGit(repoId, worktreeId, "merge", "--ff-only", "origin/" + worktree.branch);
      String output = containerGit(repoId, worktreeId, "merge", "--ff-only", "origin/" + parent);
      containerGit(repoId, worktreeId, "push", "origin", worktree.branch);
      return output;
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

  /**
   * Merges a worktree's parent branch into it so a diverged branch (one with its own commits) can
   * catch up to the parent. Unlike {@link #fastForwardWorktree}, this creates a merge commit, so it
   * works when {@code git merge --ff-only} can't. Runs inside the worktree. If the merge hits
   * conflicts it is aborted — leaving the worktree exactly as it was — and a 400 is returned. The
   * UI only offers this when the trial merge was clean, but the abort keeps the worktree usable
   * should state have changed underneath.
   */
  @Transactional
  public String updateWorktreeFromParent(String repoId, String worktreeId) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Worktree worktree =
        worktreeRepository
            .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    String parent = worktree.parent;
    if (parent == null || parent.isBlank()) {
      throw new BadRequestException("Worktree '" + worktreeId + "' has no parent to update from");
    }
    if (parent.startsWith("-")) {
      throw new BadRequestException("Invalid parent branch");
    }

    ensureContainer(repoId, worktreeId); // re-provision a lost container from the branch first
    String container = containers.containerName(worktreeId, repoId);

    // Inside the container: fetch, sync the container's own branch to origin's ref (it may have
    // advanced out-of-band), then merge the parent in (a merge commit — works where ff-only can't).
    // Identity is supplied inline. On conflict, abort so the worktree stays usable and return a
    // 400. On success, push so the origin reflects the merge.
    try {
      containerGit(repoId, worktreeId, "fetch", "origin");
      containerGit(repoId, worktreeId, "merge", "--ff-only", "origin/" + worktree.branch);
    } catch (Exception e) {
      throw new InternalServerErrorException(
          "Failed to fetch '" + parent + "' into '" + worktreeId + "': " + e.getMessage());
    }
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            java.util.Map.of(),
            "git",
            "-c",
            "user.email=qits@local",
            "-c",
            "user.name=qits",
            "merge",
            "--no-edit",
            "origin/" + parent);

    if (result.exitCode() != 0) {
      containers.exec(container, "/workspace", java.util.Map.of(), "git", "merge", "--abort");
      throw new BadRequestException(
          "Cannot merge '" + parent + "' into '" + worktreeId + "' without conflicts");
    }
    containerGit(repoId, worktreeId, "push", "origin", worktree.branch);
    recordEvent(worktree, WorktreeEventType.UPDATED_FROM_PARENT, null, parent, null);
    return result.output();
  }

  public void discardWorktree(String repoId, String worktreeId) {
    discardWorktree(repoId, worktreeId, null);
  }

  @Transactional
  public void discardWorktree(String repoId, String worktreeId, String result) {
    repositoryRepository
        .findByIdOptional(repoId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    Worktree worktree =
        worktreeRepository
            .findActiveByRepositoryAndWorktreeId(repoId, worktreeId)
            .orElseThrow(() -> new NotFoundException("Worktree not found: " + worktreeId));

    doDiscard(repoId, worktree, WorktreeStatus.ABANDONED, result);
  }

  /**
   * Removes a worktree from disk and deletes its branch, then <em>soft-deletes</em> the row: it is
   * marked with its {@code resolution} status ({@code INTEGRATED} for cleanup, {@code ABANDONED}
   * for discard) and kept as a persistent record (with its history events and the commands that ran
   * in it) rather than deleted. The on-disk metadata file is removed so discovery won't re-process
   * it.
   */
  private void doDiscard(
      String repoId, Worktree worktree, WorktreeStatus resolution, String result) {
    Path originPath = Path.of(dataDir, repoId, "origin");

    try {
      String branch = worktree.branch;

      // Remove the worktree's container (its clone dies with it — a clone is cheap to redo).
      containers.rm(containers.containerName(worktree.worktreeId, repoId));

      if (branch != null && !branch.isBlank()) {
        try {
          git.exec(originPath.toFile(), "git", "branch", "-D", "--", branch);
        } catch (Exception ignored) {
          // branch may already be gone
        }
      }

      worktree.status = resolution;
      worktree.resolvedAt = Instant.now();
      if (result != null && !result.isBlank()) {
        worktree.result = result;
      }
      recordEvent(
          worktree,
          resolution == WorktreeStatus.INTEGRATED
              ? WorktreeEventType.INTEGRATED
              : WorktreeEventType.ABANDONED,
          branch,
          null,
          null);
      metadataService.deleteWorktreeMetadata(repoId, worktree.worktreeId);
    } catch (InternalServerErrorException e) {
      throw e;
    } catch (Exception e) {
      throw new InternalServerErrorException("Git discard failed: " + e.getMessage());
    }
  }

  private Path findWorktreePathForBranch(String repoId, String branch) {
    // With workspace containers no branch has a host checkout the merge can run in, so integration
    // always spins up a throwaway host worktree in the bare origin ({@link #mergeIntoTarget}).
    // (Returning null unconditionally — rather than scanning the worktrees dir — also avoids
    // matching an unrelated on-disk checkout that shares the path.)
    return null;
  }

  public record MergeResult(
      String commitHash, boolean hasConflicts, String output, boolean cleanedUp) {}
}
