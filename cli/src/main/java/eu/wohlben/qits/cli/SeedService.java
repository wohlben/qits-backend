package eu.wohlben.qits.cli;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.RepositoryArchetype;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Seeds a basic, ready-to-poke-at setup by driving the real {@link ProjectService}/{@link
 * WorktreeService} (not raw SQL), so it always matches the current domain model and refactors are
 * caught at compile time. Invoked from the {@code seed} command in {@link Main} — see that class
 * for how to run it.
 *
 * <p>It clones the in-repo {@code testing-repo.git} fixture and builds this tree:
 *
 * <pre>
 *   Demo Project
 *     └─ Repository (testing-repo)
 *          master
 *          └─ mainline               forked from master, then advanced
 *               ├─ behind-ff         strictly behind mainline  → clickable "-N" fast-forward
 *               └─ diverged          ahead AND behind mainline → "(!)" warning
 *          feeder                    helper used to advance the branches
 * </pre>
 *
 * <p>Idempotent: if a project named {@value #PROJECT_NAME} already exists it does nothing, so the
 * command is safe to re-run.
 */
@ApplicationScoped
public class SeedService {

  private static final Logger LOG = Logger.getLogger(SeedService.class);
  private static final String PROJECT_NAME = "Demo Project";

  @Inject ProjectService projectService;

  @Inject WorktreeService worktreeService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  /** Override the clone source; defaults to the in-repo testing-repo.git fixture. */
  @ConfigProperty(name = "qits.seed.repo-url")
  Optional<String> repoUrlOverride;

  /**
   * Creates the demo project, repository and branch tree. Returns false if it was already seeded.
   *
   * <p>{@link ActivateRequestContext} so the non-transactional {@code list()} read works when this
   * runs as the {@code seed} CLI command (command mode has no ambient request context the way a
   * JAX-RS request does); the individual service calls still own their own transactions.
   */
  @ActivateRequestContext
  public boolean seed() {
    if (projectService.list().stream().anyMatch(p -> PROJECT_NAME.equals(p.name))) {
      LOG.infof("Project '%s' already exists — nothing to seed.", PROJECT_NAME);
      return false;
    }

    String url = resolveRepoUrl();
    LOG.infof("Seeding '%s' from %s ...", PROJECT_NAME, url);

    Project project = projectService.create(PROJECT_NAME, "Seeded from testing-repo fixture");
    Repository repo =
        projectService.createRepositoryUnderProject(project.id, url, RepositoryArchetype.SERVICE);

    // Build the branch tree.
    worktreeService.createWorktree(repo.id, "mainline", "master", "mainline");
    worktreeService.createWorktree(repo.id, "behind-ff", "mainline", "behind-ff");
    worktreeService.createWorktree(repo.id, "diverged", "mainline", "diverged");
    worktreeService.createWorktree(repo.id, "feeder", "feature", "feeder");

    // Advance 'mainline' (feeder carries a commit master lacks) so its children fall behind it.
    // 'behind-ff' then has no commits of its own → fast-forwardable. Giving 'diverged' its own
    // independent merge of the same content makes it both ahead of and behind mainline.
    worktreeService.mergeWorktree(repo.id, "feeder", "mainline");
    worktreeService.mergeWorktree(repo.id, "feeder", "diverged");

    // A demo daemon on the repository (daemons only exist at repository scope): a Python static
    // file server with a ready pattern and a LOG_LEVEL observer — enough to watch the whole
    // supervised lifecycle in any of the worktrees above.
    repositoryDaemonService.create(
        repo.id,
        "Python HTTP server",
        "Serves the worktree over HTTP on :8000 — a demo daemon for the supervisor",
        "python3 -m http.server 8000",
        "Serving HTTP",
        "TERM",
        RestartPolicy.ON_FAILURE,
        3,
        null,
        List.of(new LogObserver(LogObserverKind.LOG_LEVEL, null, null)),
        null);

    LOG.infof("Seeded project '%s' (%s), repository %s.", PROJECT_NAME, project.id, repo.id);
    System.out.println(
        "Seeded '"
            + PROJECT_NAME
            + "'. Open /repositories/"
            + repo.id
            + " to see the branch tree.");
    return true;
  }

  /**
   * Resolves the testing-repo.git fixture, or honours {@code qits.seed.repo-url}. It's on the test
   * classpath (copied next to the classes); for a real run from the repo it's on disk under the
   * domain module.
   */
  private String resolveRepoUrl() {
    if (repoUrlOverride.filter(s -> !s.isBlank()).isPresent()) {
      return repoUrlOverride.get();
    }
    java.net.URL onClasspath = getClass().getResource("/fixtures/testing-repo.git");
    if (onClasspath != null) {
      try {
        Path p = Path.of(onClasspath.toURI());
        if (Files.exists(p)) {
          return p.toString();
        }
      } catch (java.net.URISyntaxException ignored) {
        // fall through to the filesystem lookup
      }
    }
    String[] candidates = {
      "domain/src/test/resources/fixtures/testing-repo.git",
      "src/test/resources/fixtures/testing-repo.git",
      "../domain/src/test/resources/fixtures/testing-repo.git",
    };
    for (String candidate : candidates) {
      Path p = Path.of(candidate);
      if (Files.exists(p)) {
        return p.toAbsolutePath().toString();
      }
    }
    throw new IllegalStateException(
        "testing-repo.git fixture not found (cwd="
            + Path.of("").toAbsolutePath()
            + "); set qits.seed.repo-url to point at a repo to clone");
  }
}
