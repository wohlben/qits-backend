package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.mapper.CommandMapper;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.entity.Workspace;
import eu.wohlben.qits.domain.repository.persistence.WorkspaceRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;

/**
 * Owns every database write to {@link Command}, isolated here so the status transitions can be
 * driven both from request threads (create) and from the registry's reader thread (exit/terminate),
 * which has no request context of its own — hence {@link ActivateRequestContext} on the off-request
 * methods. Transitions away from {@code RUNNING} are idempotent (first writer wins), so the
 * manual-terminate path and the reader-thread exit path can race without double-marking.
 */
@ApplicationScoped
public class CommandLifecycleService {

  @Inject WorkspaceRepository workspaceRepository;

  @Inject CommandRepository commandRepository;

  @Inject CommandMapper commandMapper;

  /**
   * Persist a new RUNNING command and return its DTO (built in-tx so the workspace FK resolves).
   * {@code actionId} is null for launches not backed by an action (e.g. an agent session).
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
      CommandKind kind) {
    Workspace workspace =
        workspaceRepository
            .findActiveByRepositoryAndWorkspaceId(repoId, workspaceId)
            .orElseThrow(() -> new NotFoundException("Workspace not found: " + workspaceId));
    Command command =
        Command.builder()
            .workspace(workspace)
            .branch(branch)
            .commitHash(commitHash)
            .actionId(actionId)
            .actionName(actionName)
            .executeScript(executeScript)
            .interactive(interactive)
            .kind(kind)
            .status(CommandStatus.RUNNING)
            .build();
    commandRepository.persist(command);
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
