package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.agent.control.AgentType;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.mapper.CommandMapper;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import eu.wohlben.qits.domain.workspace.control.WorkspaceChangeHint;
import eu.wohlben.qits.domain.workspace.control.WorkspaceChangePublisher;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * Owns every database write to {@link Command}, isolated here so the status transitions can be
 * driven both from request threads (create) and from the registry's reader thread (exit/terminate),
 * which has no request context of its own — hence {@link ActivateRequestContext} on the off-request
 * methods. Transitions away from {@code RUNNING} are idempotent (first writer wins), so the
 * manual-terminate path and the reader-thread exit path can race without double-marking.
 */
@ApplicationScoped
public class CommandLifecycleService {

  private static final Logger LOG = Logger.getLogger(CommandLifecycleService.class);

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject CommandMapper commandMapper;

  @Inject WorkspaceChangePublisher changePublisher;

  /**
   * Persist a new RUNNING command and return its DTO (built in-tx so the workspace FK resolves).
   * {@code actionId} is null for launches not backed by an action (e.g. an agent session). The id
   * is service-generated (not DB-generated) so a caller can know it before the row exists — agent
   * launches render it into the session-report hook URL — and pass it as {@code commandId}; null
   * generates a fresh one. {@code initialAgentSession} is the first entry of an agent launch's
   * session list, persisted in the same transaction as the row so the hook can never race it; null
   * for everything that isn't an agent session (actions, daemons, the login REPL). {@code
   * agentType} is the resolved coding-agent harness (null for non-agent launches ⇒ legacy CLAUDE).
   */
  @Transactional
  public CommandDto createRunning(
      String repoId,
      String workspaceId,
      String branch,
      String commitHash,
      String actionId,
      String actionName,
      String executeScript,
      boolean interactive,
      CommandKind kind,
      String commandId,
      AgentSessionRef initialAgentSession,
      AgentType agentType) {
    Workspace workspace =
        workspaceRepository
            .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
            .orElseThrow(() -> new NotFoundException("Workspace not found: " + workspaceId));
    Command command =
        Command.builder()
            .id(commandId != null ? commandId : UUID.randomUUID().toString())
            .workspace(workspace)
            .branch(branch)
            .commitHash(commitHash)
            .actionId(actionId)
            .actionName(actionName)
            .executeScript(executeScript)
            .interactive(interactive)
            .kind(kind)
            .agentType(agentType)
            .status(CommandStatus.RUNNING)
            .build();
    if (initialAgentSession != null) {
      command.agentSessions.add(initialAgentSession);
    }
    commandRepository.persist(command);
    changePublisher.fire(repoId, workspaceId, WorkspaceChangeHint.Topic.COMMANDS);
    return commandMapper.toDto(command);
  }

  /**
   * Record a harness-reported session identity (the SessionStart hook's payload) on a running
   * command. The first report normally confirms the pinned/resumed id — it only fills in the
   * authoritative {@code transcriptPath}. A report with a different id means the user switched
   * sessions inside the interactive TUI (e.g. {@code /resume}): a {@code SWITCHED} entry is
   * appended, duplicates included, so the list stays the faithful order of sessions driven.
   */
  @Transactional
  @ActivateRequestContext
  public CommandDto recordAgentSessionReport(
      String commandId, String sessionId, String transcriptPath) {
    Command command = commandRepository.findById(commandId);
    if (command == null) {
      throw new NotFoundException("Command not found: " + commandId);
    }
    if (command.status != CommandStatus.RUNNING) {
      throw new BadRequestException("Command is not running: " + commandId);
    }
    AgentSessionRef current =
        command.agentSessions.isEmpty()
            ? null
            : command.agentSessions.get(command.agentSessions.size() - 1);
    if (current != null && current.sessionId.equals(sessionId)) {
      if (current.transcriptPath == null) {
        current.transcriptPath = transcriptPath;
      }
    } else {
      if (current == null) {
        // Agent launches that cannot pin a session id (Kimi Code) start with an empty list; the
        // first hook report establishes the session.
        LOG.debugf("Session report for command %s without a pinned session", commandId);
      }
      command.agentSessions.add(
          new AgentSessionRef(
              sessionId,
              current == null ? AgentSessionSource.REPORTED : AgentSessionSource.SWITCHED,
              null,
              transcriptPath,
              Instant.now()));
    }
    changePublisher.fire(
        command.workspace.repository.id,
        command.workspace.workspaceId,
        WorkspaceChangeHint.Topic.COMMANDS);
    return commandMapper.toDto(command);
  }

  @Transactional
  @ActivateRequestContext
  public void markExited(String commandId, int exitCode) {
    finishIfRunning(commandId, CommandStatus.EXITED, exitCode);
  }

  @Transactional
  @ActivateRequestContext
  public void markTerminated(String commandId, int exitCode) {
    finishIfRunning(commandId, CommandStatus.TERMINATED, exitCode);
  }

  private void finishIfRunning(String commandId, CommandStatus status, int exitCode) {
    Command command = commandRepository.findById(commandId);
    if (command == null || command.status != CommandStatus.RUNNING) {
      return; // idempotent: whoever transitions it first wins.
    }
    command.status = status;
    command.exitCode = exitCode;
    command.finishedAt = Instant.now();
    changePublisher.fire(
        command.workspace.repository.id,
        command.workspace.workspaceId,
        WorkspaceChangeHint.Topic.COMMANDS);
  }

  /**
   * Startup reconciliation: a fresh JVM has an empty registry, so any persisted {@code RUNNING}
   * command is an orphan whose OS process died with the previous JVM. Mark them {@code
   * INTERRUPTED}. Returns how many were reconciled.
   */
  @Transactional
  @ActivateRequestContext
  public int reconcileRunningAsInterrupted() {
    List<Command> stale = commandRepository.findByStatus(CommandStatus.RUNNING);
    Instant now = Instant.now();
    for (Command command : stale) {
      command.status = CommandStatus.INTERRUPTED;
      command.finishedAt = now;
    }
    return stale.size();
  }
}
