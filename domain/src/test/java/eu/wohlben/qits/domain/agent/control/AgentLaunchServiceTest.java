package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.Test;

/** Verifies the MCP scope → scoped-server-URL + read-only allowlist mapping of the agent path. */
@QuarkusTest
public class AgentLaunchServiceTest {

  @Inject AgentLaunchService agentLaunchService;

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
  public void actionsScopeIsRepositoryScopedWithReadOnlyActionTools() {
    String repoId = "11111111-1111-1111-1111-111111111111";

    AgentLaunchService.ScopedMcp server =
        agentLaunchService.serverFor(repoId, AgentMcpScope.ACTIONS);

    assertEquals("actions", server.key());
    assertTrue(server.url().contains("/mcp/actions?repositoryId=" + repoId), server.url());
    assertTrue(server.allowedTools().contains("mcp__actions__listGlobalActions"));
    assertTrue(server.allowedTools().contains("mcp__actions__getRepositoryAction"));
    // Mutating tools are left out so the agent still prompts before changing anything.
    assertFalse(server.allowedTools().contains("mcp__actions__createGlobalAction"));
  }

  @Test
  public void repositoryScopeIsProjectScopedThenNarrowedToTheRepository() {
    String projectId = "22222222-2222-2222-2222-222222222222";
    String repoId = "33333333-3333-3333-3333-333333333333";
    seedRepository(projectId, repoId);

    AgentLaunchService.ScopedMcp server =
        agentLaunchService.serverFor(repoId, AgentMcpScope.REPOSITORY);

    assertEquals("repository", server.key());
    assertTrue(
        server.url().contains("/mcp/repository?projectId=" + projectId + "&repositoryId=" + repoId),
        server.url());
    assertTrue(server.allowedTools().contains("mcp__repository__listBranches"));
    assertFalse(server.allowedTools().contains("mcp__repository__runAction"));
  }

  @Test
  public void projectScopeCarriesTheProjectIdWithoutRepositoryNarrowing() {
    String projectId = "44444444-4444-4444-4444-444444444444";
    String repoId = "55555555-5555-5555-5555-555555555555";
    seedRepository(projectId, repoId);

    AgentLaunchService.ScopedMcp server =
        agentLaunchService.serverFor(repoId, AgentMcpScope.PROJECT);

    assertTrue(server.url().contains("/mcp/repository?projectId=" + projectId), server.url());
    assertFalse(server.url().contains("repositoryId="), server.url());
  }

  @Test
  public void aNonUuidRepositoryIdIsRejectedBeforeReachingTheShell() {
    // A repo id that isn't a UUID must be rejected before it can be embedded in the launch command.
    assertThrows(
        BadRequestException.class,
        () -> agentLaunchService.serverFor("bad'; touch pwned; '", AgentMcpScope.ACTIONS));
  }
}
