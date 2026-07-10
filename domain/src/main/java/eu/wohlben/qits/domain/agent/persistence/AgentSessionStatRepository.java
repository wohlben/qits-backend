package eu.wohlben.qits.domain.agent.persistence;

import eu.wohlben.qits.domain.agent.entity.AgentSessionStat;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Collection;
import java.util.List;

@ApplicationScoped
public class AgentSessionStatRepository implements PanacheRepositoryBase<AgentSessionStat, String> {

  /** All stat rows (session rows and subagent rows) of the given sessions. */
  public List<AgentSessionStat> findBySessionIds(Collection<String> sessionIds) {
    if (sessionIds.isEmpty()) {
      return List.of();
    }
    return list("sessionId in ?1", sessionIds);
  }

  /**
   * Clears the given sessions' rows ahead of a re-insert — the sweep's delete-and-reinsert keys on
   * the session, not the command, so a later command re-driving the same session (resume) replaces
   * the earlier import's counts rather than duplicating them.
   */
  public void deleteBySessionIds(Collection<String> sessionIds) {
    if (!sessionIds.isEmpty()) {
      delete("sessionId in ?1", sessionIds);
    }
  }
}
