package eu.wohlben.qits.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseStepService;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import eu.wohlben.qits.domain.project.control.ProjectService;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
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
  @Inject WorktreeService worktreeService;
  @Inject RepositoryDaemonService repositoryDaemonService;
  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;
  @Inject FeatureFlowPhaseService featureFlowPhaseService;
  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;
  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

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
    // still exactly one project and its worktrees/daemons/feature-flows are back to the known-good
    // state (not duplicated, not "already exists" errors from re-creating the same worktree ids).
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
    assertGreetingWorktree(repo.id);
    assertBuildAndVerifyFeatureFlow(project.id);
  }

  /** The dev-server daemon is web-viewable, OTEL-enabled, and fully wired for log observation. */
  private void assertObservableDaemon(String repoId) {
    List<RepositoryDaemon> daemons = repositoryDaemonService.list(repoId);
    RepositoryDaemon devServer =
        daemons.stream().filter(d -> "Quarkus dev server".equals(d.name)).findFirst().orElse(null);
    assertNotNull(devServer, "Quarkus dev server daemon should be defined");
    assertEquals(8080, devServer.httpPort, "dev server daemon should be web-viewable on 8080");
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

  /** A plain feature worktree off feature/greeting exists and is active. */
  private void assertGreetingWorktree(String repoId) {
    WorktreeDto greeting =
        worktreeService.listWorktrees(repoId).stream()
            .filter(wt -> "greeting".equals(wt.worktreeId()))
            .findFirst()
            .orElse(null);
    assertNotNull(greeting, "greeting worktree should exist");
    assertEquals(WorktreeStatus.ACTIVE, greeting.status(), "greeting worktree should be active");
    assertEquals("greeting", greeting.branch(), "greeting worktree owns the 'greeting' branch");
  }

  /** The seeded feature-flow renders as Development → Build (prereq) / Lint (parallel) / Test. */
  private void assertBuildAndVerifyFeatureFlow(String projectId) {
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
  }
}
