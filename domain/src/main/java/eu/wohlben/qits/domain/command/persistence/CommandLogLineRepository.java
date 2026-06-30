package eu.wohlben.qits.domain.command.persistence;

import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import io.quarkus.hibernate.orm.panache.PanacheRepository;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class CommandLogLineRepository implements PanacheRepository<CommandLogLine> {

  /** A command's full captured log, in capture order. */
  public List<CommandLogLine> findByCommandOrderBySeq(String commandId) {
    return list("command.id = ?1 order by sequence", commandId);
  }
}
