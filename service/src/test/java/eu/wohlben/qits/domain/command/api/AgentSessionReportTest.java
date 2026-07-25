package eu.wohlben.qits.domain.command.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.project.entity.Project;
import eu.wohlben.qits.domain.project.persistence.ProjectRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The agent session-lineage sink ({@code CommandService.reportAgentSession}): first report confirms
 * the pinned session (recording the transcript path), a differing id appends a SWITCHED entry, and
 * the guards hold (unknown/finished commands and malformed ids are rejected).
 *
 * <p>Historically this was driven by the {@code POST /api/commands/{id}/agent-session} endpoint;
 * that endpoint was retired with agent-activity tracking (the SessionStart hook now routes through
 * the workspace-daemon, and {@code WorkspaceDaemonRegistry} feeds this same sink). This test now
 * exercises the sink directly — the end-to-end route-through-the-daemon is covered by {@code
 * DaemonControlSocketTest}.
 */
@QuarkusTest
public class AgentSessionReportTest {

  @Inject CommandService commandService;

  @Inject ProjectRepository projectRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  /** Seeds a command with one PINNED session entry, bypassing the process registry. */
  @Transactional
  String seedAgentCommand(String sessionId, CommandStatus status) {
    return seedCommand(
        status,
        new AgentSessionRef(sessionId, AgentSessionSource.PINNED, null, null, Instant.now()));
  }

  /** Seeds a command with the given session entries (none = an unpinned fresh Kimi launch). */
  @Transactional
  String seedCommand(CommandStatus status, AgentSessionRef... refs) {
    Project project = new Project();
    project.id = UUID.randomUUID().toString();
    project.name = "Report project";
    projectRepository.persist(project);

    Repository repository = new Repository();
    repository.id = UUID.randomUUID().toString();
    repository.url = "https://example.com/repo.git";
    repository.project = project;
    repositoryRepository.persist(repository);

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
            .actionName("Claude Code (repository MCP)")
            .executeScript("exec claude")
            .interactive(false)
            .kind(CommandKind.CHAT)
            .status(status)
            .build();
    command.agentSessions.addAll(List.of(refs));
    commandRepository.persist(command);
    return command.id;
  }

  @Test
  public void firstReportConfirmsThePinnedSessionAndRecordsThePath() {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(sessionId, CommandStatus.RUNNING);
    String path = "/claude-home/.claude/projects/-workspace/" + sessionId + ".jsonl";

    CommandDto command = commandService.reportAgentSession(commandId, sessionId, path);

    assertEquals(1, command.agentSessions().size());
    assertEquals(sessionId, command.agentSessions().get(0).sessionId());
    assertEquals(AgentSessionSource.PINNED, command.agentSessions().get(0).source());
    assertEquals(path, command.agentSessions().get(0).transcriptPath());
  }

  @Test
  public void aDifferingIdAppendsASwitchedEntryAndSwitchingBackAppendsAgain() {
    String pinned = UUID.randomUUID().toString();
    String other = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(pinned, CommandStatus.RUNNING);

    // The user ran /resume inside the TUI: the hook reports the newly-driven session.
    CommandDto afterSwitch =
        commandService.reportAgentSession(
            commandId, other, "/claude-home/.claude/projects/-workspace/" + other + ".jsonl");
    assertEquals(2, afterSwitch.agentSessions().size());
    assertEquals(other, afterSwitch.agentSessions().get(1).sessionId());
    assertEquals(AgentSessionSource.SWITCHED, afterSwitch.agentSessions().get(1).source());
    assertNotNull(afterSwitch.agentSessions().get(1).transcriptPath());

    // Switching back appends again — the list is the faithful order of sessions driven,
    // duplicates included.
    CommandDto afterBack =
        commandService.reportAgentSession(
            commandId, pinned, "/claude-home/.claude/projects/-workspace/" + pinned + ".jsonl");
    assertEquals(3, afterBack.agentSessions().size());
    assertEquals(pinned, afterBack.agentSessions().get(2).sessionId());
    assertEquals(AgentSessionSource.SWITCHED, afterBack.agentSessions().get(2).source());
  }

  @Test
  public void anUnknownCommandIsNotFound() {
    assertThrows(
        NotFoundException.class,
        () ->
            commandService.reportAgentSession(
                UUID.randomUUID().toString(), UUID.randomUUID().toString(), null));
  }

  @Test
  public void aFinishedCommandIsRejected() {
    String sessionId = UUID.randomUUID().toString();
    String commandId = seedAgentCommand(sessionId, CommandStatus.EXITED);

    assertThrows(
        BadRequestException.class,
        () -> commandService.reportAgentSession(commandId, sessionId, null));
  }

  @Test
  public void aNonUuidSessionIdIsRejected() {
    String commandId = seedAgentCommand(UUID.randomUUID().toString(), CommandStatus.RUNNING);

    assertThrows(
        BadRequestException.class,
        () -> commandService.reportAgentSession(commandId, "../../../etc/passwd", null));
  }

  @Test
  public void aKimiSessionIdIsAccepted() {
    String kimiSession = "session_" + UUID.randomUUID();
    String commandId = seedAgentCommand(UUID.randomUUID().toString(), CommandStatus.RUNNING);
    String path =
        "/claude-home/.kimi-code/sessions/wd_workspace_c52ddf65534b/"
            + kimiSession
            + "/agents/main/wire.jsonl";

    CommandDto command = commandService.reportAgentSession(commandId, kimiSession, path);

    assertEquals(2, command.agentSessions().size());
    assertEquals(kimiSession, command.agentSessions().get(1).sessionId());
    assertEquals(AgentSessionSource.SWITCHED, command.agentSessions().get(1).source());
  }

  @Test
  public void aFirstReportOnAnUnpinnedCommandEstablishesAReportedSession() {
    // A fresh Kimi launch cannot pin a session id, so the command starts with an empty session
    // list and the first hook report establishes the session as REPORTED.
    String kimiSession = "session_" + UUID.randomUUID();
    String commandId = seedCommand(CommandStatus.RUNNING);
    String path =
        "/claude-home/.kimi-code/sessions/wd_workspace_c52ddf65534b/"
            + kimiSession
            + "/agents/main/wire.jsonl";

    CommandDto command = commandService.reportAgentSession(commandId, kimiSession, path);

    assertEquals(1, command.agentSessions().size());
    assertEquals(kimiSession, command.agentSessions().get(0).sessionId());
    assertEquals(AgentSessionSource.REPORTED, command.agentSessions().get(0).source());
    assertEquals(path, command.agentSessions().get(0).transcriptPath());
  }
}
