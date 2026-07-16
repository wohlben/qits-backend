package eu.wohlben.qits.cli;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.HealthCheckKind;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
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
 * docs/features/2026-07-05_servable-quarkus-angular-fixture.md}), so features that run real work in
 * a workspace — dev-server daemons, the web-view picker, actions, the coding agent — have a
 * plausible app to point at. Sibling of {@link SeedService} (which seeds the tiny {@code
 * testing-repo} for pure git-mechanics demos); invoked from the {@code seed-webapp} command in
 * {@link Main}.
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
 *     │    + a web-viewable "Quarkus dev server" daemon: web view on :4200 (the Quinoa-spawned
 *     │      Angular dev server) opening at /greeting, otel=true, LOG_LEVEL + PATTERN observers,
 *     │      a FILE LogSource tailing quarkus.log
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

  @Inject RepositoryDaemonService repositoryDaemonService;

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
    Repository repo =
        projectService.createRepositoryUnderProject(
            project.id, url, RepositoryArchetype.SERVICE, true);

    // A web-viewable dev-server daemon: `quarkus:dev` serving the Quarkus REST API plus the Angular
    // SPA (Quinoa), live-reloaded. The web view frames the FRONTEND dev server (the topology the
    // web-view config recommends): Quinoa spawns `ng serve` on :4200, whose start script (the
    // fixture's package.json) binds 0.0.0.0, serves under $QITS_PUBLIC_BASE (--serve-path) and
    // dev-proxies the app's API calls to Quarkus (proxy.conf.js) — so assets, HMR and api/greetings
    // all stay inside the proxy prefix. Quarkus itself also serves under the base (root-path),
    // which
    // lets the dev proxy forward the based API path verbatim. entryPath "greeting" lands the frame
    // straight on the greeting screen.
    //
    // otel=true => the supervisor injects OTEL_EXPORTER_OTLP_* (endpoint, protobuf protocol,
    // service
    // name, qits.* resource attributes), so the app the fixture ships (quarkus-opentelemetry)
    // exports
    // traces/logs/metrics to the in-process receiver, bucketed by workspace/repository.
    //
    // Log observers: LOG_LEVEL classifies Java stack traces / *Exception out of the box; the
    // PATTERN
    // observer flags Quarkus dev-mode build/startup failures as ERROR. The FILE LogSource tails the
    // rolling quarkus.log the fixture writes (quarkus.log.file.*) into those same observers.
    repositoryDaemonService.create(
        repo.id,
        "Quarkus dev server",
        "Runs `./mvnw quarkus:dev` — the Quarkus REST API and the Angular SPA (Quinoa),"
            + " live-reloaded and web-viewable through the qits proxy.",
        // Quarkus does NOT read the generic OTEL_* SDK env vars, so the OTEL_EXPORTER_OTLP_ENDPOINT
        // qits injects (otel=true) is ignored and export falls back to localhost:4317 → fails.
        // Bridge
        // it into the Quarkus config key here at launch. See
        // docs/issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md.
        "./mvnw -q quarkus:dev"
            + " -Dquarkus.http.host=0.0.0.0"
            + " -Dquarkus.http.port=8080"
            + " -Dquarkus.http.root-path=\"${QITS_PUBLIC_BASE:-/}\""
            + " -Dquarkus.otel.exporter.otlp.endpoint="
            + "\"${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}\"",
        // The frame targets :4200, so readiness = the Angular dev server being up (Quinoa logs it
        // once ng serve answers), not Quarkus' own earlier "Listening on:" line.
        "(?i)dev server is up|Application bundle generation complete|Local:.*:4200",
        "TERM",
        RestartPolicy.ON_FAILURE,
        true, // autoStart: the demo — starting the greeting workspace brings this dev server up
        3,
        true,
        4200,
        "greeting",
        null,
        null,
        List.of(
            new LogObserver(LogObserverKind.LOG_LEVEL, null, null),
            new LogObserver(
                LogObserverKind.PATTERN,
                "(?i)(BUILD FAILURE|Failed to start Quarkus|Live reload failed)",
                DaemonEventSeverity.ERROR)),
        List.of(new LogSource("quarkus.log", "Quarkus dev log")),
        // The reference healthchecks — the two-servers-one-daemon case this feature exists for.
        // Quarkus serves under $QITS_PUBLIC_BASE (see -Dquarkus.http.root-path above), so its
        // /q/health is NOT at the bare root — a COMMAND check expands the env var at probe time
        // (the plain HTTP kind is deliberately shell-free and can't). Angular: any HTTP answer on
        // :4200 means the dev server is serving (it may 404 bare paths under a serve-path);
        // connection-refused while it compiles is the red-then-green demo.
        List.of(
            new HealthCheck(
                "Quarkus",
                HealthCheckKind.COMMAND,
                null,
                null,
                null,
                "curl -fsS -m 2 \"http://127.0.0.1:8080${QITS_PUBLIC_BASE%/}/q/health\"",
                null,
                null,
                null,
                null,
                null),
            new HealthCheck(
                "Angular",
                HealthCheckKind.HTTP,
                4200,
                "/",
                "2xx,3xx,4xx",
                null,
                null,
                null,
                null,
                null,
                null)));

    // One plain feature workspace so the detail view has more than one workspace to browse and run
    // the
    // dev server in — no divergence manufacturing (that's testing-repo's job). feature/greeting is
    // a
    // fast-forward over main.
    workspaceService.createWorkspace(repo.id, "greeting", "feature/greeting", "greeting");

    // A repository-scoped one-off beside the build/lint/test set below. Cascade-deleted with the
    // repository, so the reset keeps this idempotent.
    actionConfigurationService.createForRepository(
        repo.id,
        "Stack info",
        "Show the Quarkus stack of this app (extensions, platform version).",
        "./mvnw -q quarkus:info",
        null,
        false,
        null);

    // A feature-flow configuration expressing the stack's build/lint/test actions. Blueprint only —
    // qits does not execute these; the real run happens via daemons/commands.
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
    ActionConfiguration build =
        repositoryAction(
            repositoryId,
            "build-project",
            "Compile and package the app; the Angular bundle is baked into the jar.",
            "./mvnw package");
    ActionConfiguration lintBackend =
        repositoryAction(
            repositoryId,
            "lint-backend",
            "Check the Java sources' formatting / static analysis.",
            "./mvnw spotless:check");
    ActionConfiguration lintFrontend =
        repositoryAction(
            repositoryId,
            "lint-frontend",
            "Lint the Angular sources.",
            "pnpm --dir src/main/webui lint");
    ActionConfiguration test =
        repositoryAction(
            repositoryId,
            "run-unit-tests",
            "Run the @QuarkusTest suite for POST /api/greetings.",
            "./mvnw test");

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

  private ActionConfiguration repositoryAction(
      String repositoryId, String name, String description, String executeScript) {
    return actionConfigurationService.createForRepository(
        repositoryId, name, description, executeScript, null, false, null);
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
