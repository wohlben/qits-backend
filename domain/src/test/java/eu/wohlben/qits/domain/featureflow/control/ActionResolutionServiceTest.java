package eu.wohlben.qits.domain.featureflow.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.Test;

/** Verifies that action variants are rendered into the right command by the resolver. */
@QuarkusTest
public class ActionResolutionServiceTest {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionResolutionService actionResolutionService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Transactional
  void seedRepository(String projectId, String repositoryId) {
    Project project = new Project();
    project.id = projectId;
    project.name = "Test project";
    projectRepository.persist(project);

    Repository repository = new Repository();
    repository.id = repositoryId;
    repository.url = "https://example.com/repo.git";
    repository.project = project;
    repositoryRepository.persist(repository);
  }

  @Test
  public void shellVariantResolvesToTheScriptVerbatim() {
    var action =
        actionConfigurationService.create(
            "Shell test", null, "mvn test", null, false, ActionVariant.SHELL, null);

    var resolved = actionResolutionService.resolveForRepository("repo-xyz", action.id);

    assertEquals("mvn test", resolved.executeScript());
  }

  @Test
  public void claudeActionsMcpVariantRendersRepoScopedMcpFlags() {
    var action =
        actionConfigurationService.create(
            "Claude MCP", null, "exec claude", null, true, ActionVariant.CLAUDE_ACTIONS_MCP, null);

    String repoId = "11111111-1111-1111-1111-111111111111";
    var resolved = actionResolutionService.resolveForRepository(repoId, action.id);
    String cmd = resolved.executeScript();

    assertTrue(cmd.startsWith("exec claude "), cmd);
    assertTrue(cmd.contains("--strict-mcp-config"), cmd);
    assertTrue(cmd.contains("--mcp-config"), cmd);
    assertTrue(cmd.contains("/mcp/actions?repositoryId=" + repoId), cmd);
    // Read-only tools are pre-approved; mutating ones are left to prompt.
    assertTrue(cmd.contains("--allowedTools"), cmd);
    assertTrue(cmd.contains("mcp__actions__listGlobalActions"), cmd);
    assertTrue(cmd.contains("mcp__actions__getGlobalAction"), cmd);
    assertTrue(cmd.contains("mcp__actions__listRepositoryActions"), cmd);
    assertTrue(cmd.contains("mcp__actions__getRepositoryAction"), cmd);
    assertTrue(cmd.contains("mcp__actions__createGlobalAction") == false, cmd);
    assertTrue(cmd.contains("mcp__actions__deleteRepositoryAction") == false, cmd);
    // The flags are built by the backend — the action's stored script doesn't contain them.
    assertEquals("exec claude", action.executeScript);
  }

  @Test
  public void claudeRepositoryMcpVariantRendersProjectScopedMcpFlags() {
    String projectId = "22222222-2222-2222-2222-222222222222";
    String repoId = "33333333-3333-3333-3333-333333333333";
    seedRepository(projectId, repoId);

    var action =
        actionConfigurationService.create(
            "Claude repo MCP",
            null,
            "exec claude",
            null,
            true,
            ActionVariant.CLAUDE_REPOSITORY_MCP,
            null);

    var resolved = actionResolutionService.resolveForRepository(repoId, action.id);
    String cmd = resolved.executeScript();

    assertTrue(cmd.startsWith("exec claude "), cmd);
    assertTrue(cmd.contains("--strict-mcp-config"), cmd);
    // Project-scoped, then narrowed to this one repository — the URL carries both ids.
    assertTrue(
        cmd.contains("/mcp/repository?projectId=" + projectId + "&repositoryId=" + repoId), cmd);
    assertTrue(cmd.contains("\"repository\":{\"type\":\"http\""), cmd);
    // Read-only repository tools are pre-approved; mutating ones are left to prompt.
    assertTrue(cmd.contains("mcp__repository__listRepositories"), cmd);
    assertTrue(cmd.contains("mcp__repository__listBranches"), cmd);
    assertTrue(cmd.contains("mcp__repository__getCommitFileDiff"), cmd);
    assertTrue(cmd.contains("mcp__repository__listActions"), cmd);
    assertTrue(cmd.contains("mcp__repository__createWorktree") == false, cmd);
    assertTrue(cmd.contains("mcp__repository__integrateBranch") == false, cmd);
    assertTrue(cmd.contains("mcp__repository__runAction") == false, cmd);
    // The flags are built by the backend — the action's stored script doesn't contain them.
    assertEquals("exec claude", action.executeScript);
  }

  @Test
  public void claudeProjectMcpVariantRendersProjectScopeWithoutRepositoryNarrowing() {
    String projectId = "44444444-4444-4444-4444-444444444444";
    String repoId = "55555555-5555-5555-5555-555555555555";
    seedRepository(projectId, repoId);

    var action =
        actionConfigurationService.create(
            "Claude project MCP",
            null,
            "exec claude",
            null,
            true,
            ActionVariant.CLAUDE_PROJECT_MCP,
            null);

    var resolved = actionResolutionService.resolveForRepository(repoId, action.id);
    String cmd = resolved.executeScript();

    assertTrue(cmd.contains("\"repository\":{\"type\":\"http\""), cmd);
    // Whole-project scope: the project id is present, but the repository narrowing is NOT.
    assertTrue(cmd.contains("/mcp/repository?projectId=" + projectId), cmd);
    assertTrue(cmd.contains("repositoryId=") == false, cmd);
    // Same read-only repository allowlist as the per-repository variant.
    assertTrue(cmd.contains("mcp__repository__listRepositories"), cmd);
    assertTrue(cmd.contains("mcp__repository__createWorktree") == false, cmd);
  }

  @Test
  public void claudeActionsMcpRejectsANonUuidRepositoryId() {
    var action =
        actionConfigurationService.create(
            "Claude MCP guard",
            null,
            "exec claude",
            null,
            true,
            ActionVariant.CLAUDE_ACTIONS_MCP,
            null);

    // A repo id that isn't a UUID must be rejected before it can be embedded in the shell command.
    assertThrows(
        BadRequestException.class,
        () -> actionResolutionService.resolveForRepository("bad'; touch pwned; '", action.id));
  }
}
