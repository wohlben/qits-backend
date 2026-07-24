package eu.wohlben.qits.cli;

import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.RepositoryArchetype;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Seeds a basic, ready-to-poke-at setup by driving the real {@link ProjectService}/{@link
 * WorkspaceService} (not raw SQL), so it always matches the current domain model and refactors are
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

  @Inject WorkspaceService workspaceService;

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
        projectService.createRepositoryUnderProject(
            project.id, url, RepositoryArchetype.SERVICE, true);

    // No demo service is seeded: services are declared in a repository's committed
    // .qits-config.yml (read in-container per workspace), not in any host-side store, and
    // testing-repo declares none. seed owns git merge/divergence; service supervision demos live
    // in seed-webapp's fixture config.

    // Build the branch tree.
    workspaceService.createWorkspace(repo.id, "mainline", "master", "mainline");
    workspaceService.createWorkspace(repo.id, "behind-ff", "mainline", "behind-ff");
    workspaceService.createWorkspace(repo.id, "diverged", "mainline", "diverged");
    workspaceService.createWorkspace(repo.id, "feeder", "feature", "feeder");

    // Advance 'mainline' (feeder carries a commit master lacks) so its children fall behind it.
    // 'behind-ff' then has no commits of its own → fast-forwardable. Giving 'diverged' its own
    // independent merge of the same content makes it both ahead of and behind mainline.
    workspaceService.mergeWorkspace(repo.id, "feeder", "mainline");
    workspaceService.mergeWorkspace(repo.id, "feeder", "diverged");

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
   * classpath (derived from the {@code testing-repo} submodule by scripts/derive-fixture-bares.sh);
   * for a real run from the repo it's on disk under a module's {@code target/test-classes}.
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
      "domain/target/test-classes/fixtures/testing-repo.git",
      "target/test-classes/fixtures/testing-repo.git",
      "../domain/target/test-classes/fixtures/testing-repo.git",
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
