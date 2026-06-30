package eu.wohlben.qits.domain.repository.persistence;

import eu.wohlben.qits.domain.repository.entity.WorktreeEvent;
import io.quarkus.hibernate.orm.panache.PanacheRepository;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class WorktreeEventRepository implements PanacheRepository<WorktreeEvent> {

  /** A worktree's events in chronological order. */
  public List<WorktreeEvent> findByWorktreeOrderByAt(Long worktreeId) {
    return list("worktree.id = ?1 order by at, id", worktreeId);
  }
}
