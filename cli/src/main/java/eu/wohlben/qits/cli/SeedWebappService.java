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
 * Seeds a demo project around the <b>servable</b> {@code testing-repo-quarkus-angular.git} fixture
 * (a minimal Quarkus 3 + Angular app, see {@code
 * docs/features/2026-07-05_servable-quarkus-angular-fixture.md}), so features that run real work in
 * a worktree — dev-server daemons, the web-view picker, actions, the coding agent — have a
 * plausible app to point at. Sibling of {@link SeedService} (which seeds the tiny {@code
 * testing-repo} for pure git-mechanics demos); invoked from the {@code seed-webapp} command in
 * {@link Main}.
 *
 * <p>It drives the real {@link ProjectService}/{@link WorktreeService}/{@link
 * RepositoryDaemonService} (not raw SQL), so it always matches the current domain model, and builds
 * this tree:
 *
 * <pre>
 *   Quarkus + Angular Demo
 *     └─ Repository (testing-repo-quarkus-angular)   + a "Quarkus dev server" daemon (web-viewable)
 *          main                     the default worktree (created at clone time)
 *          └─ mainline              forked from main, then advanced by merging the feeder
 *               └─ behind-ff        strictly behind mainline → clickable "-N" fast-forward
 *          feeder                   carries feature/greeting's extra commit, advances mainline
 * </pre>
 *
 * <p>(The tiny fixture's {@code feature/greeting} is a linear descendant of {@code main}, so it can
 * only demo the fast-forwardable state here — a "diverged/conflict" worktree needs a
 * cleanly-diverging branch, which the {@code seed} command already demonstrates on {@code
 * testing-repo}.)
 *
 * <p><b>Idempotent by reset:</b> unlike {@link SeedService} (skip-if-exists), this command
 * <em>deletes</em> any prior {@value #PROJECT_NAME} project first, so every run resets it to the
 * same known-good state — safe to re-run as a fixture for manual UI poking and automated regression
 * tests.
 */
@ApplicationScoped
public class SeedWebappService {

  private static final Logger LOG = Logger.getLogger(SeedWebappService.class);
  static final String PROJECT_NAME = "Quarkus + Angular Demo";

  @Inject ProjectService projectService;

  @Inject WorktreeService worktreeService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  /**
   * Override the clone source; defaults to the in-repo testing-repo-quarkus-angular.git fixture.
   */
  @ConfigProperty(name = "qits.seed.webapp-repo-url")
  Optional<String> repoUrlOverride;

  /**
   * Resets and re-creates the demo project, repository, dev-server daemon and branch tree. Returns
   * the created repository.
   *
   * <p>{@link ActivateRequestContext} so the non-transactional {@code list()} read works in command
   * mode (which has no ambient request context the way a JAX-RS request does); the individual
   * service calls still own their own transactions.
   */
  @ActivateRequestContext
  public Repository seed() {
    // Idempotent by reset: drop any prior instance so every run yields the same known-good state.
    // Project deletion cascades to its repositories (containers, worktree branches) and
    // feature-flow
    // configs, so this fully tears down what a previous run created.
    projectService.list().stream()
        .filter(p -> PROJECT_NAME.equals(p.name))
        .forEach(
            p -> {
              LOG.infof("Resetting existing project '%s' (%s) ...", p.name, p.id);
              projectService.delete(p.id);
            });

    String url = resolveRepoUrl();
    LOG.infof("Seeding '%s' from %s ...", PROJECT_NAME, url);

    Project project =
        projectService.create(
            PROJECT_NAME,
            "Servable Quarkus 3 + Angular demo (testing-repo-quarkus-angular fixture)");
    Repository repo =
        projectService.createRepositoryUnderProject(project.id, url, RepositoryArchetype.SERVICE);

    // A web-viewable dev-server daemon: `quarkus:dev` serving the Quarkus REST API plus the Angular
    // SPA (Quinoa), live-reloaded. httpPort set => the daemon is web-viewable, so the supervisor
    // injects QITS_PUBLIC_BASE and publishes the port. Per the web-view base-path contract
    // (docs/features/2026-07-05_daemon-webview-picker.md) the dev server must bind all interfaces
    // and
    // serve under that prefix; Quarkus does both via quarkus.http.host/root-path.
    repositoryDaemonService.create(
        repo.id,
        "Quarkus dev server",
        "Runs `./mvnw quarkus:dev` — the Quarkus REST API and the Angular SPA (Quinoa),"
            + " live-reloaded and web-viewable through the qits proxy.",
        "./mvnw -q quarkus:dev"
            + " -Dquarkus.http.host=0.0.0.0"
            + " -Dquarkus.http.port=8080"
            + " -Dquarkus.http.root-path=\"${QITS_PUBLIC_BASE:-/}\"",
        // Quarkus logs "Listening on: http://0.0.0.0:8080" once the HTTP server is up.
        "Listening on",
        "TERM",
        RestartPolicy.ON_FAILURE,
        3,
        null,
        8080,
        null,
        List.of(new LogObserver(LogObserverKind.LOG_LEVEL, null, null)),
        null);

    // A small branch tree so worktree states are visible on the real app. feature/greeting carries
    // one commit main lacks, reused here as the feeder that advances mainline.
    worktreeService.createWorktree(repo.id, "mainline", "main", "mainline");
    worktreeService.createWorktree(repo.id, "behind-ff", "mainline", "behind-ff");
    worktreeService.createWorktree(repo.id, "feeder", "feature/greeting", "feeder");

    // Advance 'mainline' (feeder carries a commit it lacks) so 'behind-ff' — forked from mainline
    // before this merge, with no commits of its own — becomes strictly behind it, i.e.
    // fast-forwardable.
    worktreeService.mergeWorktree(repo.id, "feeder", "mainline");

    LOG.infof("Seeded project '%s' (%s), repository %s.", PROJECT_NAME, project.id, repo.id);
    System.out.println(
        "Seeded '"
            + PROJECT_NAME
            + "'. Open /repositories/"
            + repo.id
            + " to see the branch tree and launch the Quarkus dev server.");
    return repo;
  }

  /**
   * Resolves the testing-repo-quarkus-angular.git fixture, or honours {@code
   * qits.seed.webapp-repo-url}. It's on the test classpath (copied next to the classes); for a real
   * run from the repo it's on disk under the domain module.
   */
  private String resolveRepoUrl() {
    if (repoUrlOverride.filter(s -> !s.isBlank()).isPresent()) {
      return repoUrlOverride.get();
    }
    java.net.URL onClasspath = getClass().getResource("/fixtures/testing-repo-quarkus-angular.git");
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
      "domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git",
      "src/test/resources/fixtures/testing-repo-quarkus-angular.git",
      "../domain/src/test/resources/fixtures/testing-repo-quarkus-angular.git",
    };
    for (String candidate : candidates) {
      Path p = Path.of(candidate);
      if (Files.exists(p)) {
        return p.toAbsolutePath().toString();
      }
    }
    throw new IllegalStateException(
        "testing-repo-quarkus-angular.git fixture not found (cwd="
            + Path.of("").toAbsolutePath()
            + "); set qits.seed.webapp-repo-url to point at a repo to clone");
  }
}
