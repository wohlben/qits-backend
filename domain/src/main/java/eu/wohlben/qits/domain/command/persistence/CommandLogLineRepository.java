package eu.wohlben.qits.domain.command.persistence;

import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import eu.wohlben.qits.domain.command.entity.LogChannel;
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

  /** One channel's lines with sequence strictly below the bound, in order. */
  public List<CommandLogLine> findByCommandAndChannelAndSeqLessThanOrderBySeq(
      String commandId, LogChannel channel, long sequenceExclusive) {
    return list(
        "command.id = ?1 and channel = ?2 and sequence < ?3 order by sequence",
        commandId,
        channel,
        sequenceExclusive);
  }

  /** The subset of a command's log on exactly {@code channel}, in capture order. */
  public List<CommandLogLine> findByCommandAndChannelOrderBySeq(
      String commandId, LogChannel channel) {
    return list("command.id = ?1 and channel = ?2 order by sequence", commandId, channel);
  }

  /** Delete a command's lines on one channel; returns how many rows went. */
  public long deleteByCommandAndChannel(String commandId, LogChannel channel) {
    return delete("command.id = ?1 and channel = ?2", commandId, channel);
  }
}
