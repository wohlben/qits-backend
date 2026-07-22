package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.agent.acp.AcpSessionConfig;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Verifies Kimi Code launch rendering and the harness-specific guard rails. */
@QuarkusTest
@TestProfile(AgentLaunchServiceKimiTest.KimiProfile.class)
public class AgentLaunchServiceKimiTest {

  private static final String KIMI_SESSION = "session_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  public static class KimiProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.agent.type", "kimi");
    }
  }

  @Inject AgentLaunchService agentLaunchService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

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

  /** Seeds a workspace whose one command owns {@code sessionId} (backs the resume/fork probes). */
  @Transactional
  void seedCommandWithSession(String projectId, String repositoryId, String sessionId) {
    seedRepository(projectId, repositoryId);

    Repository repository = repositoryRepository.findByIdOptional(repositoryId).orElseThrow();
    Workspace workspace = new Workspace();
    workspace.workspaceId = "work";
    workspace.repository = repository;
    workspace.branch = "feature/x";
    workspaceRepository.persist(workspace);

    Command command =
        Command.builder()
            .id(UUID.randomUUID().toString())
            .workspace(workspace)
            .branch("feature/x")
            .commitHash("abcdef1234567890")
            .actionName("Kimi Code (repository MCP)")
            .executeScript("kimi")
            .interactive(false)
            .kind(CommandKind.TERMINAL)
            .status(CommandStatus.EXITED)
            .build();
    command.agentSessions.add(
        new AgentSessionRef(sessionId, AgentSessionSource.REPORTED, null, null, Instant.now()));
    commandRepository.persist(command);
  }

  /**
   * The production shape of a fresh Kimi launch: no session ref (Kimi cannot pin), only the command
   * id the session-report hook URL is rendered from.
   */
  private static AgentLaunchService.PinnedSession unpinned() {
    return new AgentLaunchService.PinnedSession(UUID.randomUUID().toString(), null);
  }

  @Test
  public void renderInteractiveUsesKimi() {
    String projectId = "00000000-0000-0000-0000-000000000001";
    String repoId = "11111111-1111-1111-1111-111111111111";
    seedRepository(projectId, repoId);

    AgentLaunchService.PinnedSession pinned = unpinned();
    LaunchSpec spec =
        agentLaunchService.renderInteractive(
            repoId, "work", AgentMcpScope.REPOSITORY, "look around", pinned);

    assertTrue(spec.script().contains("\nkimi"), spec.script());
    assertTrue(spec.script().contains("look around"), spec.script());
    // A fresh Kimi launch has no session ref; the launch-local config.toml carries the report hook.
    assertTrue(spec.script().contains("[[hooks]]"), spec.script());
    assertTrue(
        spec.script().contains("/api/commands/" + pinned.commandId() + "/agent-session"),
        spec.script());
    // Kimi handles KIMI_CODE_HOME itself; no HOME overlay from the launcher.
    assertFalse(spec.environment().containsKey("HOME"), spec.environment().toString());
  }

  @Test
  public void renderAutonomousUsesKimiWithStreamJson() {
    String projectId = "22222222-2222-2222-2222-222222222222";
    String repoId = "33333333-3333-3333-3333-333333333333";
    seedRepository(projectId, repoId);

    AgentLaunchService.PinnedSession pinned = unpinned();
    LaunchSpec spec =
        agentLaunchService.renderAutonomous(repoId, "work", AgentMcpScope.REPOSITORY, pinned);

    assertTrue(
        spec.script().contains("kimi -p '" + AgentLaunchService.TASK_PROMPT_BOOTSTRAP + "'"),
        spec.script());
    assertTrue(spec.script().contains("--output-format stream-json"), spec.script());
    assertTrue(spec.script().contains("[[hooks]]"), spec.script());
    assertTrue(
        spec.script().contains("/api/commands/" + pinned.commandId() + "/agent-session"),
        spec.script());
  }

  @Test
  public void renderLoginUsesKimiLoginAgainstRealVolumeHome() {
    LaunchSpec spec = agentLaunchService.renderLogin();

    assertEquals("exec kimi login", spec.script());
    assertTrue(spec.environment().containsKey("KIMI_CODE_HOME"), spec.environment().toString());
    assertEquals("/claude-home/.kimi-code", spec.environment().get("KIMI_CODE_HOME"));
  }

  @Test
  public void freshKimiLaunchDoesNotPinASessionId() {
    String projectId = "44444444-4444-4444-4444-444444444444";
    String repoId = "55555555-5555-5555-5555-555555555555";
    seedRepository(projectId, repoId);

    AgentLaunchService.PinnedSession pinned =
        agentLaunchService.pinSession(repoId, "work", null, false);

    assertNull(pinned.ref());
  }

  @Test
  public void forkIsRejectedForKimi() {
    String projectId = "66666666-6666-6666-6666-666666666666";
    String repoId = "77777777-7777-7777-7777-777777777777";
    seedCommandWithSession(projectId, repoId, KIMI_SESSION);

    // A fork WITH a resumable session must hit the Kimi-specific guard, not a generic null check.
    BadRequestException thrown =
        assertThrows(
            BadRequestException.class,
            () -> agentLaunchService.pinSession(repoId, "work", KIMI_SESSION, true));
    assertEquals("fork is not supported by Kimi Code", thrown.getMessage());
  }

  @Test
  public void interactiveForkIsRejectedForKimi() {
    String repoId = "88888888-8888-8888-8888-888888888888";

    BadRequestException thrown =
        assertThrows(
            BadRequestException.class,
            () ->
                agentLaunchService.launchInteractive(
                    repoId, "work", AgentMcpScope.REPOSITORY, null, KIMI_SESSION, true, false));
    assertEquals("fork is not supported by Kimi Code", thrown.getMessage());
  }

  @Test
  public void resumeWithAPlainUuidIsRejectedForKimi() {
    String repoId = "99999999-9999-9999-9999-999999999999";

    // Kimi session ids are session_<uuid>; a canonical (Claude-shaped) UUID is a 400.
    assertThrows(
        BadRequestException.class,
        () -> agentLaunchService.pinSession(repoId, "work", UUID.randomUUID().toString(), false));
  }

  @Test
  public void resumeWithAnUnownedKimiSessionIsRejected() {
    String repoId = "aaaaaaaa-0000-0000-0000-000000000000";

    BadRequestException thrown =
        assertThrows(
            BadRequestException.class,
            () -> agentLaunchService.pinSession(repoId, "work", KIMI_SESSION, false));
    assertTrue(thrown.getMessage().contains("does not belong"), thrown.getMessage());
  }

  @Test
  public void renderChatUsesKimiAcp() {
    String projectId = "aaaaaaaa-0000-0000-0000-000000000001";
    String repoId = "bbbbbbbb-1111-1111-1111-111111111111";
    seedRepository(projectId, repoId);

    LaunchSpec spec =
        agentLaunchService.renderChat(repoId, "work", AgentMcpScope.REPOSITORY, unpinned());

    // Kimi chat is the ACP transport — a plain `exec kimi acp`, no per-launch farm and no mcp.json
    // (the MCP scope rides the ACP session/new instead).
    assertEquals("exec kimi acp", spec.script());
    assertFalse(spec.script().contains("mcp.json"), spec.script());
    assertFalse(spec.environment().containsKey("HOME"), spec.environment().toString());
  }

  @Test
  public void acpSessionConfigCarriesScopedServersWithBareEnabledTools() {
    String projectId = "cccccccc-2222-2222-2222-222222222222";
    String repoId = "dddddddd-3333-3333-3333-333333333333";
    seedRepository(projectId, repoId);

    AcpSessionConfig config =
        agentLaunchService.buildAcpSessionConfig(
            repoId, "work", AgentMcpScope.REPOSITORY, unpinned());

    assertEquals("/workspace", config.cwd());
    assertNull(config.resumeSessionId(), "a fresh chat resumes nothing");
    assertEquals(1, config.mcpServers().size());
    AcpSessionConfig.AcpMcpServer repository = config.mcpServers().get(0);
    assertEquals("repository", repository.name());
    // The scoped URL is the same one serversFor builds (narrowed to this repository + workspace).
    assertTrue(repository.url().contains("repositoryId=" + repoId), repository.url());
    assertTrue(repository.url().contains("workspaceId=work"), repository.url());
    // enabledTools are bare (the mcp__repository__ prefix stripped for the ACP channel).
    assertTrue(
        repository.enabledTools().contains("taskPrompt"), repository.enabledTools().toString());
    assertTrue(
        repository.enabledTools().stream().noneMatch(t -> t.startsWith("mcp__")),
        repository.enabledTools().toString());
  }

  @Test
  public void acpSessionConfigCarriesTheResumedSessionId() {
    String projectId = "eeeeeeee-4444-4444-4444-444444444444";
    String repoId = "ffffffff-5555-5555-5555-555555555555";
    seedCommandWithSession(projectId, repoId, KIMI_SESSION);

    AgentLaunchService.PinnedSession resumed =
        agentLaunchService.pinSession(repoId, "work", KIMI_SESSION, false);
    AcpSessionConfig config =
        agentLaunchService.buildAcpSessionConfig(repoId, "work", AgentMcpScope.REPOSITORY, resumed);

    assertEquals(KIMI_SESSION, config.resumeSessionId());
  }
}
