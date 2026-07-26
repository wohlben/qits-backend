package eu.wohlben.qits.cli;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.dto.WorkspaceDto;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.RepositoryArchetype;
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
@TestProfile(SeedLitServiceTest.TestProfile.class)
public class SeedLitServiceTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      try {
        Path tempDir = Files.createTempDirectory("qits-seed-lit-test");
        return Map.of("qits.repositories.data-dir", tempDir.toString());
      } catch (Exception e) {
        throw new RuntimeException(e);
      }
    }
  }

  @Inject SeedLitService seedLitService;
  @Inject ProjectService projectService;
  @Inject WorkspaceService workspaceService;
  @Inject ContainerRuntime containers;
  @Inject FeatureFlowConfigurationService featureFlowConfigurationService;
  @Inject FeatureFlowPhaseService featureFlowPhaseService;
  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;
  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  // No @TestTransaction: the reset does delete-then-recreate, which must span separate committed
  // transactions exactly as command mode does (each @Transactional service call commits on its
  // own). Wrapping it in one test transaction would flush both in a single Hibernate session and
  // trip a transient-reference error that never occurs in the real CLI. This profile boots its own
  // Quarkus instance with a clean in-memory H2, so leaving committed rows behind is harmless.
  @Test
  public void seedsLitStackDemoWithFeatureFlowIdempotentByReset() {
    // Drives the command via the real services with no JAX-RS request context — a guard for the
    // command-mode wiring (@ActivateRequestContext on seed()).
    Repository first = seedLitService.seed();
    assertNotNull(first, "first seed should create the repository");

    // Idempotent by reset: a second run tears the prior project down and recreates it, so there is
    // still exactly one project and its workspaces/feature-flows are back to the known-good state
    // (not duplicated, not "already exists" errors from re-creating the same workspace ids).
    Repository second = seedLitService.seed();
    assertNotNull(second);
    assertEquals(
        1,
        projectService.list().stream()
            .filter(p -> SeedLitService.PROJECT_NAME.equals(p.name))
            .count(),
        "reset should leave exactly one project");

    Project project =
        projectService.list().stream()
            .filter(p -> SeedLitService.PROJECT_NAME.equals(p.name))
            .findFirst()
            .orElse(null);
    assertNotNull(project, "demo project should exist");

    // Filter, don't index: the project also owns its PROJECT-archetype wrapper, and
    // getRepositories has no `order by`, so get(0) is both wrong and non-deterministic.
    Repository repo =
        projectService.getRepositories(project.id).stream()
            .filter(r -> r.archetype != RepositoryArchetype.PROJECT)
            .findFirst()
            .orElseThrow(() -> new AssertionError("the seed registered no repository"));
    assertEquals("main", repo.mainBranch, "fixture's default branch is 'main'");

    // The dev-server daemon and build/lint/test actions come from the fixture's committed
    // .qits-config.yml (read in-container per workspace) — nothing daemon-shaped to assert
    // host-side.
    assertGreetingWorkspace(repo.id);
    assertBuildAndVerifyFeatureFlow(project.id);

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

    // The Lint step binds the code-seeded global Bash action once in the 'lint' parallel group
    // (config-declared actions are not bindable; a same-action pair in one step is rejected).
    FeatureFlowPhaseStep lint =
        steps.stream().filter(s -> "Lint".equals(s.name)).findFirst().orElseThrow();
    List<FeatureFlowPhaseAction> lintActions = featureFlowPhaseActionService.listByStep(lint.id);
    assertEquals(1, lintActions.size(), "Lint has one action");
    assertTrue(
        lintActions.stream().allMatch(a -> "lint".equals(a.parallelGroup)),
        "Lint actions share the 'lint' parallel group");
    assertTrue(
        lintActions.stream().allMatch(a -> a.actionType == ActionType.QUALITY_GATE),
        "Lint actions are quality gates");
  }
}
