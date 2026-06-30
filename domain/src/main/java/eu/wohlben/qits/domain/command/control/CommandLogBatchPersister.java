package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import eu.wohlben.qits.domain.command.persistence.CommandLogLineRepository;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Persists a batch of captured log lines in one transaction, off the request path. Isolated in its
 * own bean so {@code CommandLogService}'s background writer thread invokes it through the CDI proxy
 * (so {@link Transactional}/{@link ActivateRequestContext} actually apply — a self-invocation would
 * bypass them). The owning command is loaded once per batch and shared across its lines.
 */
@ApplicationScoped
public class CommandLogBatchPersister {

  @Inject CommandRepository commandRepository;

  @Inject CommandLogLineRepository commandLogLineRepository;

  @Transactional
  @ActivateRequestContext
  public void persist(List<CommandLogService.PendingLine> batch) {
    Map<String, Command> commands = new HashMap<>();
    for (CommandLogService.PendingLine line : batch) {
      Command command = commands.computeIfAbsent(line.commandId(), commandRepository::findById);
      if (command == null) {
        continue; // the command row is gone (e.g. deleted); drop its orphaned log line.
      }
      commandLogLineRepository.persist(
          CommandLogLine.builder()
              .command(command)
              .sequence(line.sequence())
              .channel(line.channel())
              .content(line.content())
              .timestamp(line.timestamp())
              .build());
    }
  }
}
