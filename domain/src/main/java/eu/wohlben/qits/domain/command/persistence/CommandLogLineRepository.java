package eu.wohlben.qits.domain.command.persistence;

import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import eu.wohlben.qits.domain.command.entity.LogSeverity;
import io.quarkus.hibernate.orm.panache.PanacheRepository;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class CommandLogLineRepository implements PanacheRepository<CommandLogLine> {

  /** A command's full captured log, in capture order. */
  public List<CommandLogLine> findByCommandOrderBySeq(String commandId) {
    return list("command.id = ?1 order by sequence", commandId);
  }

  /** The subset of a command's log stamped with exactly {@code severity}, in capture order. */
  public List<CommandLogLine> findByCommandAndSeverityOrderBySeq(
      String commandId, LogSeverity severity) {
    return list("command.id = ?1 and severity = ?2 order by sequence", commandId, severity);
  }

  /** The head of a command's log: lines with sequence strictly below the bound, in order. */
  public List<CommandLogLine> findByCommandAndSeqLessThanOrderBySeq(
      String commandId, long sequenceExclusive) {
    return list(
        "command.id = ?1 and sequence < ?2 order by sequence", commandId, sequenceExclusive);
  }
}
