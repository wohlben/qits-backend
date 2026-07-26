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
 * Seeds a demo project around the <b>servable</b> {@code testing-repo-quarkus-lit.git} fixture (a
 * minimal Quarkus 3 + Lit web-components app, see {@code
 * docs/epics/qits-lit-webcomponents/features/2026-07-26_servable-quarkus-lit-fixture.md}) — the
 * second frontend stack qits demos, alongside {@link SeedWebappService}'s Angular one. Invoked from
 * the {@code seed-lit} command in {@link Main}.
 *
 * <p>It drives the real domain services (not raw SQL), so it always matches the current model. It
 * builds this tree:
 *
 * <pre>
 *   Quarkus + Lit Demo
 *     ├─ Repository (testing-repo-quarkus-lit)
 *     │    + the service and build/lint/test actions declared in the fixture's committed
 *     │      .qits-config.yml — read in-container per workspace by the workspace-daemon (a
 *     │      web-viewable "Quarkus dev server" framing Vite on :5173, otel), not ingested host-side
 *     │    main       the default workspace (created at clone time)
 *     │    greeting   a plain workspace off feature/greeting (a fast-forward over main)
 *     └─ "Build & Verify" feature-flow configuration (Build / Lint / Test — blueprint only,
 *        binding the code-seeded global Bash action)
 * </pre>
 *
 * <p>No merge/divergence tree is manufactured here — that is {@code testing-repo}'s job (see the
 * {@code seed} command). The fixture ships its branches ({@code main}, {@code feature/greeting} FF,
 * {@code feature/diverged} conflicting in the webui) for any test that needs them.
 *
 * <p><b>Idempotent by reset:</b> like {@link SeedWebappService}, every run <em>deletes</em> any
 * prior {@value #PROJECT_NAME} project first, so it always returns to the same known-good state.
 * Unlike that seed there is no stale-global-action cleanup: {@code seed-lit} never had a version
 * that created global actions, so it has nothing historical to mop up.
 */
@ApplicationScoped
public class SeedLitService {

  private static final Logger LOG = Logger.getLogger(SeedLitService.class);
  static final String PROJECT_NAME = "Quarkus + Lit Demo";

  @Inject ProjectService projectService;

  @Inject WorkspaceService workspaceService;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;

  @Inject FeatureFlowPhaseService featureFlowPhaseService;

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  /** Override the clone source; defaults to the in-repo testing-repo-quarkus-lit.git fixture. */
  @ConfigProperty(name = "qits.seed.lit-repo-url")
  Optional<String> repoUrlOverride;

  /**
   * Resets and re-creates the demo project, repository and branch tree. Returns the created
   * repository.
   *
   * <p>{@link ActivateRequestContext} so the non-transactional {@code list()} read works in command
   * mode (which has no ambient request context the way a JAX-RS request does); the individual
   * service calls still own their own transactions.
   */
  @ActivateRequestContext
  public Repository seed() {
    // Idempotent by reset: drop any prior instance so every run yields the same known-good state.
    // Project deletion cascades to its repositories (containers, workspace branches) and
    // feature-flow configs, so this fully tears down what a previous run created.
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
            "Servable Quarkus 3 + Lit web-components demo (testing-repo-quarkus-lit fixture)");
    Repository repo =
        projectService.createRepositoryUnderProject(
            project.id, url, RepositoryArchetype.SERVICE, true);
    // The fixture's committed .qits-config.yml (the dev-server service, the build/lint/test
    // actions, the bootstrap chain, the ts-lit framework declaration) is the workspace-scoped
    // source of truth: the workspace-daemon reads it in-container per workspace — there is no
    // host-side ingestion on clone.

    // One plain feature workspace so the detail view has more than one workspace to browse and run
    // the dev server in — no divergence manufacturing (that's testing-repo's job). feature/greeting
    // is a fast-forward over main.
    workspaceService.createWorkspace(repo.id, "greeting", "feature/greeting", "greeting");

    // A feature-flow configuration blueprint for the stack's build/lint/test flow. Blueprint only —
    // qits does not execute these; config-declared actions are not bindable, so the steps bind the
    // code-seeded global Bash action.
    seedFeatureFlow(project.id);

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
   * "Development" phase with Build (prerequisite) → Lint (quality gate) → Test (quality gate).
   * Configurations hang off the <em>project</em> (not the repository). This is a blueprint — qits
   * never executes these scripts.
   *
   * <p>Only code-based actions are feature-flow-bindable (config-declared actions live in the
   * workspace's {@code .qits-config.yml} and have no DB row to FK to), so every step binds the
   * code-seeded global {@code Bash} action — same shape as {@link SeedWebappService}.
   */
  private void seedFeatureFlow(String projectId) {
    ActionConfiguration bash =
        actionConfigurationService.list().stream()
            .filter(a -> "Bash".equals(a.name))
            .findFirst()
            .orElseThrow(
                () -> new IllegalStateException("Global 'Bash' action not seeded at startup"));

    FeatureFlowConfiguration config =
        featureFlowConfigurationService.createUnderProject(projectId, "Build & Verify");
    FeatureFlowPhase development =
        featureFlowPhaseService.create(
            config.id,
            "Development",
            "Build, lint and test the Quarkus + Lit web-components app.",
            0,
            null);

    FeatureFlowPhaseStep buildStep = featureFlowPhaseStepService.create(development.id, "Build", 0);
    featureFlowPhaseActionService.create(buildStep.id, bash.id, ActionType.PREREQUISITE, 0, null);

    FeatureFlowPhaseStep lintStep = featureFlowPhaseStepService.create(development.id, "Lint", 1);
    featureFlowPhaseActionService.create(lintStep.id, bash.id, ActionType.QUALITY_GATE, 0, "lint");

    FeatureFlowPhaseStep testStep = featureFlowPhaseStepService.create(development.id, "Test", 2);
    featureFlowPhaseActionService.create(testStep.id, bash.id, ActionType.QUALITY_GATE, 0, null);
  }

  /**
   * Resolves the testing-repo-quarkus-lit.git fixture, or honours {@code qits.seed.lit-repo-url}.
   * It's on the test classpath (derived from the {@code testing-repo-quarkus-lit} submodule by
   * scripts/derive-fixture-bares.sh); for a real run from the repo it's on disk under a module's
   * {@code target/test-classes}.
   */
  private String resolveRepoUrl() {
    if (repoUrlOverride.filter(s -> !s.isBlank()).isPresent()) {
      return repoUrlOverride.get();
    }
    java.net.URL onClasspath = getClass().getResource("/fixtures/testing-repo-quarkus-lit.git");
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
      "domain/target/test-classes/fixtures/testing-repo-quarkus-lit.git",
      "target/test-classes/fixtures/testing-repo-quarkus-lit.git",
      "../domain/target/test-classes/fixtures/testing-repo-quarkus-lit.git",
    };
    for (String candidate : candidates) {
      Path p = Path.of(candidate);
      if (Files.exists(p)) {
        return p.toAbsolutePath().toString();
      }
    }
    throw new IllegalStateException(
        "testing-repo-quarkus-lit.git fixture not found (cwd="
            + Path.of("").toAbsolutePath()
            + "); set qits.seed.lit-repo-url to point at a repo to clone");
  }
}
