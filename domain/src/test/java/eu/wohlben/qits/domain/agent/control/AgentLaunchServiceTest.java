package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.control.QitsHostResolver;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Verifies the MCP scope → scoped-server-URL + read-only allowlist mapping of the agent path. */
@QuarkusTest
public class AgentLaunchServiceTest {

  @Inject AgentLaunchService agentLaunchService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject QitsHostResolver qitsHostResolver;

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
  public void actionsScopeCarriesTheActionsServerAndTheNarrowedRepositoryServer() {
    String projectId = "00000000-0000-0000-0000-000000000001";
    String repoId = "11111111-1111-1111-1111-111111111111";
    seedRepository(projectId, repoId);

    List<AgentLaunchService.ScopedMcp> servers =
        agentLaunchService.serversFor(repoId, "work", AgentMcpScope.ACTIONS);

    assertEquals(2, servers.size(), "configure sessions get the actions AND repository servers");
    AgentLaunchService.ScopedMcp actions = servers.get(0);
    assertEquals("actions", actions.key());
    assertTrue(actions.url().contains("/mcp/actions?repositoryId=" + repoId), actions.url());
    assertTrue(actions.allowedTools().contains("mcp__actions__listGlobalActions"));
    assertTrue(actions.allowedTools().contains("mcp__actions__getRepositoryAction"));
    // Mutating tools are left out so the agent still prompts before changing anything.
    assertFalse(actions.allowedTools().contains("mcp__actions__createGlobalAction"));

    // The repository server rides along, narrowed to this repository — daemons and the other
    // repository-owned configuration are managed there.
    AgentLaunchService.ScopedMcp repository = servers.get(1);
    assertEquals("repository", repository.key());
    assertTrue(
        repository
            .url()
            .contains(
                "/mcp/repository?projectId="
                    + projectId
                    + "&repositoryId="
                    + repoId
                    + "&workspaceId=work"),
        repository.url());
  }

  @Test
  public void repositoryScopeIsProjectScopedThenNarrowedToTheRepository() {
    String projectId = "22222222-2222-2222-2222-222222222222";
    String repoId = "33333333-3333-3333-3333-333333333333";
    seedRepository(projectId, repoId);

    AgentLaunchService.ScopedMcp server =
        agentLaunchService.serversFor(repoId, "work", AgentMcpScope.REPOSITORY).getFirst();

    assertEquals("repository", server.key());
    assertTrue(
        server
            .url()
            .contains(
                "/mcp/repository?projectId="
                    + projectId
                    + "&repositoryId="
                    + repoId
                    + "&workspaceId=work"),
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
        agentLaunchService.serversFor(repoId, "work", AgentMcpScope.PROJECT).getFirst();

    assertTrue(server.url().contains("/mcp/repository?projectId=" + projectId), server.url());
    assertFalse(server.url().contains("repositoryId="), server.url());
  }

  @Test
  public void mcpUrlsUseTheContainerReachableGitHostNotLocalhost() {
    // Regression: the MCP base URL used to be hardcoded to http://localhost:8080, which from inside
    // the workspace container is the container's own loopback — not qits. It must derive from the
    // same QitsHostResolver the git clone uses, so the agent's MCP server is actually reachable.
    // See docs/issues/resolved/2026-07-05_agent-mcp-unreachable-from-container.md.
    String projectId = "88888888-8888-8888-8888-888888888888";
    String repoId = "99999999-9999-9999-9999-999999999999";
    seedRepository(projectId, repoId);

    String host = qitsHostResolver.qitsHost();
    List<AgentLaunchService.ScopedMcp> servers =
        agentLaunchService.serversFor(repoId, "work", AgentMcpScope.ACTIONS);

    for (AgentLaunchService.ScopedMcp server : servers) {
      assertFalse(server.url().contains("localhost"), server.url());
      assertTrue(
          server.url().startsWith("http://" + host + ":8080/mcp/" + server.key() + "?"),
          server.url());
    }
  }

  @Test
  public void aNonUuidRepositoryIdIsRejectedBeforeReachingTheShell() {
    // A repo id that isn't a UUID must be rejected before it can be embedded in the launch command.
    assertThrows(
        BadRequestException.class,
        () -> agentLaunchService.serversFor("bad'; touch pwned; '", "work", AgentMcpScope.ACTIONS));
  }

  @Test
  public void chatLaunchPointsHomeAtTheSharedCredentialVolume() {
    // The agent authenticates from the shared ~/.claude volume mounted in the container, so its
    // launch must set HOME to the mount (default /claude-home) — the one credential hand-off.
    String projectId = "66666666-6666-6666-6666-666666666666";
    String repoId = "77777777-7777-7777-7777-777777777777";
    seedRepository(projectId, repoId);

    LaunchSpec spec = agentLaunchService.renderChat(repoId, "work", AgentMcpScope.ACTIONS);

    assertEquals("/claude-home", spec.environment().get("HOME"));
    // Still the stream-json chat, unchanged.
    assertTrue(spec.script().contains("--input-format stream-json"), spec.script());
  }

  @Test
  public void autonomousLaunchPointsHomeAtTheSharedCredentialVolume() {
    LaunchSpec spec = agentLaunchService.renderAutonomous("resolve the conflict");

    assertEquals("/claude-home", spec.environment().get("HOME"));
    assertTrue(spec.script().startsWith("claude -p 'resolve the conflict'"), spec.script());
  }

  @Test
  public void loginTerminalRunsTheInteractiveClaudeRepl() {
    // When the agent isn't signed in, launchChat redirects to this interactive terminal so the
    // operator completes OAuth in a real PTY; it writes to the shared credential volume. It runs
    // the
    // `claude` REPL (whose onboarding has a paste-the-code login), NOT `claude auth login` — that
    // subcommand blocks on an unreachable loopback callback and reads no stdin (see the resolved
    // issue doc 2026-07-05_claude-auth-login-terminal-no-input.md).
    LaunchSpec spec = agentLaunchService.renderLogin();

    assertEquals("exec claude", spec.script());
    assertTrue(spec.interactive());
    assertEquals("/claude-home", spec.environment().get("HOME"));
  }
}
