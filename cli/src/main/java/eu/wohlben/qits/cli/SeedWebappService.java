package eu.wohlben.qits.cli;

import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseStepService;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
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
 * docs/epics/qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md}), so
 * features that run real work in a workspace — dev-server daemons, the web-view picker, actions,
 * the coding agent — have a plausible app to point at. Sibling of {@link SeedService} (which seeds
 * the tiny {@code testing-repo} for pure git-mechanics demos); invoked from the {@code seed-webapp}
 * command in {@link Main}.
 *
 * <p>It drives the real domain services (not raw SQL), so it always matches the current model. This
 * fixture is the <b>stack-specific</b> substrate (the counterpart to {@code testing-repo}, which
 * owns git-mechanics/merge/divergence): it exercises the logic {@code hello.txt} can't — framework
 * detection, a real {@code quarkus:dev} web-view daemon, OTEL observability, daemon log
 * observation, a Java+node feature-flow blueprint, and the coding agent against a real app. It
 * builds this tree:
 *
 * <pre>
 *   Quarkus + Angular Demo
 *     ├─ Repository (testing-repo-quarkus-angular)
 *     │    + the daemon and build/lint/test actions ingested from the fixture's committed
 *     │      .qits-config.yml on clone (a web-viewable "Quarkus dev server" on :4200 → /greeting,
 *     │      otel, LOG_LEVEL + PATTERN observers, a quarkus.log FILE source) — see
 *     │      docs/epics/qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md
 *     │    main       the default workspace (created at clone time)
 *     │    greeting   a plain workspace off feature/greeting (a fast-forward over main)
 *     └─ "Build & Verify" feature-flow configuration (Build / Lint / Test — blueprint only)
 * </pre>
 *
 * <p>No merge/divergence tree is manufactured here — that is {@code testing-repo}'s job (see the
 * {@code seed} command). The fixture ships its branches ({@code main}, {@code feature/greeting} FF,
 * {@code feature/diverged} conflicting) for any test that needs them.
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

  @Inject WorkspaceService workspaceService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

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
    // Project deletion cascades to its repositories (containers, workspace branches) and
    // feature-flow
    // configs, so this fully tears down what a previous run created.
    projectService.list().stream()
        .filter(p -> PROJECT_NAME.equals(p.name))
        .forEach(
            p -> {
              LOG.infof("Resetting existing project '%s' (%s) ...", p.name, p.id);
              projectService.delete(p.id);
            });
    // Earlier seed versions created the build/lint/test set (and, before 1529f10, per-run
    // duplicates of it) as GLOBAL actions; they are repository-scoped now, so clean up what those
    // versions left behind in long-lived dev databases.
    cleanupStaleSeedGlobals();

    String url = resolveRepoUrl();
    LOG.infof("Seeding '%s' from %s ...", PROJECT_NAME, url);

    Project project =
        projectService.create(
            PROJECT_NAME,
            "Servable Quarkus 3 + Angular demo (testing-repo-quarkus-angular fixture)");
    // Cloning ingests the fixture's committed .qits-config.yml (docs/epics/
    // qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md): the
    // web-viewable "Quarkus dev server"
    // daemon
    // (web view :4200 → /greeting, otel, LOG_LEVEL + PATTERN observers, a quarkus.log FILE source,
    // Quarkus COMMAND + Angular HTTP health checks) and the build/lint/test + Stack info actions.
    // Those rows are declared in the file, not built here — the seed only wires them into a
    // project.
    Repository repo =
        projectService.createRepositoryUnderProject(
            project.id, url, RepositoryArchetype.SERVICE, true);

    // One plain feature workspace so the detail view has more than one workspace to browse and run
    // the dev server in — no divergence manufacturing (that's testing-repo's job). feature/greeting
    // is a fast-forward over main.
    workspaceService.createWorkspace(repo.id, "greeting", "feature/greeting", "greeting");

    // A feature-flow configuration expressing the stack's build/lint/test actions. Blueprint only —
    // qits does not execute these; it binds the config-ingested actions by their declared name.
    seedFeatureFlow(project.id, repo.id);

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
   * Seeds a "Build &amp; Verify" feature-flow configuration under the project: a single
   * "Development" phase with Build (prerequisite) → Lint (two quality-gate actions sharing a
   * parallel group) → Test (quality gate). Configurations hang off the <em>project</em> (not the
   * repository). This is a blueprint — qits never executes these scripts.
   *
   * <p>The bound actions are <b>repository-scoped</b>: their commands are this stack's ({@code
   * ./mvnw}, {@code pnpm}), meaningless in a repository that isn't Quarkus + Angular. They
   * cascade-delete with the repository, so the project reset keeps this idempotent with no
   * reconcile bookkeeping.
   */
  private void seedFeatureFlow(String projectId, String repositoryId) {
    // The build/lint/test actions were ingested from the fixture's .qits-config.yml on clone (their
    // stored names carry the reserved @qits-config suffix); bind those existing rows by id.
    ActionConfiguration build = configAction(repositoryId, "build-project");
    ActionConfiguration lintBackend = configAction(repositoryId, "lint-backend");
    ActionConfiguration lintFrontend = configAction(repositoryId, "lint-frontend");
    ActionConfiguration test = configAction(repositoryId, "run-unit-tests");

    FeatureFlowConfiguration config =
        featureFlowConfigurationService.createUnderProject(projectId, "Build & Verify");
    FeatureFlowPhase development =
        featureFlowPhaseService.create(
            config.id, "Development", "Build, lint and test the Quarkus + Angular app.", 0, null);

    FeatureFlowPhaseStep buildStep = featureFlowPhaseStepService.create(development.id, "Build", 0);
    featureFlowPhaseActionService.create(buildStep.id, build.id, ActionType.PREREQUISITE, 0, null);

    // Two actions in one step sharing a parallel group => they may run concurrently.
    FeatureFlowPhaseStep lintStep = featureFlowPhaseStepService.create(development.id, "Lint", 1);
    featureFlowPhaseActionService.create(
        lintStep.id, lintBackend.id, ActionType.QUALITY_GATE, 0, "lint");
    featureFlowPhaseActionService.create(
        lintStep.id, lintFrontend.id, ActionType.QUALITY_GATE, 1, "lint");

    FeatureFlowPhaseStep testStep = featureFlowPhaseStepService.create(development.id, "Test", 2);
    featureFlowPhaseActionService.create(testStep.id, test.id, ActionType.QUALITY_GATE, 0, null);
  }

  /**
   * The config-ingested repository action declared under {@code baseName} (stored with the reserved
   * {@code @qits-config} suffix). Fails loudly if ingestion didn't produce it — the fixture's
   * {@code .qits-config.yml} is the source of truth for these, so a miss means the file drifted.
   */
  private ActionConfiguration configAction(String repositoryId, String baseName) {
    String stored = QitsConfig.configName(baseName);
    return actionConfigurationService.listForRepository(repositoryId).stream()
        .filter(a -> stored.equals(a.name))
        .findFirst()
        .orElseThrow(
            () ->
                new IllegalStateException(
                    "Expected .qits-config.yml to declare action '"
                        + baseName
                        + "' but it was not ingested for repository "
                        + repositoryId));
  }

  /**
   * Deletes the <b>global</b> actions earlier seed versions created under the seed-owned names —
   * they are repository-scoped now, and the leaked pre-1529f10 duplicates (see
   * docs/issues/resolved/2026-07-09_seed-webapp-leaks-global-actions.md) are equally stale. A row
   * still bound by a feature flow is spared with a warning (the phase-action FK has no cascade;
   * deleting it would both fail and break that flow) — the demo project's own flow is already gone
   * when this runs, so only user-made flows can hold one.
   */
  private void cleanupStaleSeedGlobals() {
    List<String> seedOwnedNames =
        List.of(
            "build-project",
            "lint-backend",
            "lint-frontend",
            "run-unit-tests",
            "Stack info",
            "stackinfo");
    for (ActionConfiguration stale :
        actionConfigurationService.list().stream()
            .filter(a -> seedOwnedNames.contains(a.name))
            .toList()) {
      if (featureFlowPhaseActionService.isActionBound(stale.id)) {
        LOG.warnf(
            "Keeping stale global action '%s' (%s): a feature flow still binds it.",
            stale.name, stale.id);
        continue;
      }
      LOG.infof("Deleting stale seed-owned global action '%s' (%s).", stale.name, stale.id);
      actionConfigurationService.delete(stale.id);
    }
  }

  /**
   * Resolves the testing-repo-quarkus-angular.git fixture, or honours {@code
   * qits.seed.webapp-repo-url}. It's on the test classpath (derived from the {@code
   * testing-repo-quarkus-angular} submodule by scripts/derive-fixture-bares.sh, alongside the
   * {@code qits-fixture-angular.git} sibling its {@code .gitmodules} resolves to); for a real run
   * from the repo it's on disk under a module's {@code target/test-classes}.
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
      "domain/target/test-classes/fixtures/testing-repo-quarkus-angular.git",
      "target/test-classes/fixtures/testing-repo-quarkus-angular.git",
      "../domain/target/test-classes/fixtures/testing-repo-quarkus-angular.git",
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
