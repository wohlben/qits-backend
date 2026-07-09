package eu.wohlben.qits.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseStepService;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.dto.WorkspaceDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.WorkspaceRuntimeStatus;
import eu.wohlben.qits.domain.repository.entity.WorkspaceStatus;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

@QuarkusTest
@TestProfile(SeedWebappServiceTest.TestProfile.class)
public class SeedWebappServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-seed-webapp-test");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject SeedWebappService seedWebappService;
  @Inject ProjectService projectService;
  @Inject WorkspaceService workspaceService;
  @Inject ContainerRuntime containers;
  @Inject RepositoryDaemonService repositoryDaemonService;
  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;
  @Inject FeatureFlowPhaseService featureFlowPhaseService;
  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;
  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;
  @Inject ActionConfigurationService actionConfigurationService;

  // No @TestTransaction: the reset does delete-then-recreate, which must span separate committed
  // transactions exactly as command mode does (each @Transactional service call commits on its
  // own).
  // Wrapping it in one test transaction would flush both in a single Hibernate session and trip a
  // transient-reference error that never occurs in the real CLI. This profile boots its own Quarkus
  // instance with a clean in-memory H2, so leaving committed rows behind is harmless.
  @Test
  public void seedsStackDemoWithObservableDaemonAndFeatureFlow() {
    // Drives the command via the real services with no JAX-RS request context — a guard for the
    // command-mode wiring (@ActivateRequestContext on seed()).
    Repository first = seedWebappService.seed();
    assertNotNull(first, "first seed should create the repository");

    // Idempotent by reset: a second run tears the prior project down and recreates it, so there is
    // still exactly one project and its workspaces/daemons/feature-flows are back to the known-good
    // state (not duplicated, not "already exists" errors from re-creating the same workspace ids).
    Repository second = seedWebappService.seed();
    assertNotNull(second);
    assertEquals(
        1,
        projectService.list().stream()
            .filter(p -> SeedWebappService.PROJECT_NAME.equals(p.name))
            .count(),
        "reset should leave exactly one project");

    Project project =
        projectService.list().stream()
            .filter(p -> SeedWebappService.PROJECT_NAME.equals(p.name))
            .findFirst()
            .orElse(null);
    assertNotNull(project, "demo project should exist");

    Repository repo = projectService.getRepositories(project.id).get(0);
    assertEquals("main", repo.mainBranch, "fixture's default branch is 'main'");

    assertObservableDaemon(repo.id);
    assertGreetingWorkspace(repo.id);
    assertBuildAndVerifyFeatureFlow(project.id, repo.id);

    // Seeding is pure host-side data setup — no container ran (the daemon is a definition only;
    // it launches on demand later), and every workspace waits STOPPED for its first use.
    assertTrue(
        containers.listWorkspaceContainers(repo.id).isEmpty(),
        "seeding must not provision containers");
    for (WorkspaceDto wt : workspaceService.listWorkspaces(repo.id)) {
      assertEquals(
          WorkspaceRuntimeStatus.STOPPED,
          wt.runtimeStatus(),
          "seeded workspace " + wt.workspaceId() + " starts unprovisioned");
    }
  }

  /**
   * The seed's build/lint/test actions are <b>repository-scoped</b> now (their commands are this
   * stack's — meaningless elsewhere), so the reset must (a) recreate them exactly once on the new
   * repository, (b) delete the stale <b>global</b> copies earlier seed versions created (incl. the
   * pre-1529f10 leak, docs/issues/resolved/2026-07-09_seed-webapp-leaks-global-actions.md), and (c)
   * spare a global copy some other project's flow still binds (its FK has no cascade — deleting
   * would break that flow).
   */
  @Test
  public void resetRescopesSeedActionsAndCleansStaleGlobals() {
    seedWebappService.seed();

    // Simulate what earlier seed versions left behind: a stale, drifted global copy...
    actionConfigurationService.create(
        "build-project", "drifted", "echo drifted", "echo check", true, Map.of("K", "V"));
    // ...and a global copy that a non-demo project's flow still binds.
    ActionConfiguration boundDupe =
        actionConfigurationService.create(
            "run-unit-tests", "user copy", "echo user", null, false, null);
    Project userProject = projectService.create("User Project", null);
    FeatureFlowConfiguration userFlow =
        featureFlowConfigurationService.createUnderProject(userProject.id, "User Flow");
    FeatureFlowPhase userPhase =
        featureFlowPhaseService.create(userFlow.id, "Phase", null, 0, null);
    FeatureFlowPhaseStep userStep = featureFlowPhaseStepService.create(userPhase.id, "Step", 0);
    featureFlowPhaseActionService.create(
        userStep.id, boundDupe.id, ActionType.QUALITY_GATE, 0, null);

    Repository repo = seedWebappService.seed();

    // The stale unbound global copy is deleted, not reconciled — the action lives on the
    // repository now.
    assertTrue(
        globalActionsNamed("build-project").isEmpty(),
        "stale global seed actions are cleaned up on reset");

    // Each seed-owned action exists exactly once, owned by the (re-created) repository.
    List<ActionConfiguration> repoActions = actionConfigurationService.listForRepository(repo.id);
    for (String name :
        List.of("build-project", "lint-backend", "lint-frontend", "run-unit-tests", "Stack info")) {
      assertEquals(
          1,
          repoActions.stream().filter(a -> name.equals(a.name)).count(),
          "'" + name + "' should exist exactly once, repository-scoped");
    }
    ActionConfiguration build =
        repoActions.stream().filter(a -> "build-project".equals(a.name)).findFirst().orElseThrow();
    assertEquals("./mvnw package", build.executeScript, "the seeded script, not the drifted one");
    assertNull(build.checkScript);
    assertFalse(build.interactive);

    // The flow-bound global copy survives (deleting it would break the user's flow).
    List<ActionConfiguration> tests = globalActionsNamed("run-unit-tests");
    assertEquals(1, tests.size(), "only the user's still-bound global copy remains");
    assertEquals(boundDupe.id, tests.get(0).id, "a flow-bound copy must be spared by the reset");
  }

  private List<ActionConfiguration> globalActionsNamed(String name) {
    return actionConfigurationService.list().stream().filter(a -> name.equals(a.name)).toList();
  }

  /** The dev-server daemon is web-viewable, OTEL-enabled, and fully wired for log observation. */
  private void assertObservableDaemon(String repoId) {
    List<RepositoryDaemon> daemons = repositoryDaemonService.list(repoId);
    RepositoryDaemon devServer =
        daemons.stream().filter(d -> "Quarkus dev server".equals(d.name)).findFirst().orElse(null);
    assertNotNull(devServer, "Quarkus dev server daemon should be defined");
    assertNotNull(devServer.webView, "dev server daemon should be web-viewable");
    assertEquals(
        4200, devServer.webView.port, "the web view frames the Angular dev server (:4200)");
    assertEquals("greeting", devServer.webView.entryPath, "the frame opens on the greeting screen");
    assertTrue(devServer.otel, "dev server daemon should export OTEL");

    assertTrue(
        devServer.observers.stream().anyMatch(o -> o.kind == LogObserverKind.LOG_LEVEL),
        "should have a LOG_LEVEL observer");
    assertTrue(
        devServer.observers.stream().anyMatch(o -> o.kind == LogObserverKind.PATTERN),
        "should have a PATTERN observer");
    assertTrue(
        devServer.sources.stream().anyMatch(s -> "quarkus.log".equals(s.path)),
        "should tail the quarkus.log file source");
  }

  /** A plain feature workspace off feature/greeting exists and is active. */
  private void assertGreetingWorkspace(String repoId) {
    WorkspaceDto greeting =
        workspaceService.listWorkspaces(repoId).stream()
            .filter(wt -> "greeting".equals(wt.workspaceId()))
            .findFirst()
            .orElse(null);
    assertNotNull(greeting, "greeting workspace should exist");
    assertEquals(WorkspaceStatus.ACTIVE, greeting.status(), "greeting workspace should be active");
    assertEquals("greeting", greeting.branch(), "greeting workspace owns the 'greeting' branch");
  }

  /** The seeded feature-flow renders as Development → Build (prereq) / Lint (parallel) / Test. */
  private void assertBuildAndVerifyFeatureFlow(String projectId, String repoId) {
    List<FeatureFlowConfiguration> configs =
        featureFlowConfigurationService.listByProject(projectId);
    FeatureFlowConfiguration config =
        configs.stream().filter(c -> "Build & Verify".equals(c.name)).findFirst().orElse(null);
    assertNotNull(config, "Build & Verify configuration should exist");

    List<FeatureFlowPhase> phases =
        featureFlowPhaseService.listByFeatureFlowConfiguration(config.id);
    assertEquals(1, phases.size(), "one top-level phase");
    FeatureFlowPhase development = phases.get(0);
    assertEquals("Development", development.name);

    List<FeatureFlowPhaseStep> steps = featureFlowPhaseStepService.listByPhase(development.id);
    assertEquals(
        List.of("Build", "Lint", "Test"),
        steps.stream().map(s -> s.name).toList(),
        "steps in order");

    // The Lint step's two actions share a parallel group.
    FeatureFlowPhaseStep lint =
        steps.stream().filter(s -> "Lint".equals(s.name)).findFirst().orElseThrow();
    List<FeatureFlowPhaseAction> lintActions = featureFlowPhaseActionService.listByStep(lint.id);
    assertEquals(2, lintActions.size(), "Lint has two actions");
    assertTrue(
        lintActions.stream().allMatch(a -> "lint".equals(a.parallelGroup)),
        "Lint actions share the 'lint' parallel group");
    assertTrue(
        lintActions.stream().allMatch(a -> a.actionType == ActionType.QUALITY_GATE),
        "Lint actions are quality gates");

    // The flow binds the repository-scoped actions (the commands are this stack's, not globals).
    List<String> repoActionIds =
        actionConfigurationService.listForRepository(repoId).stream().map(a -> a.id).toList();
    assertTrue(
        lintActions.stream().allMatch(a -> repoActionIds.contains(a.actionConfiguration.id)),
        "flow-bound actions belong to the seeded repository");
  }
}
