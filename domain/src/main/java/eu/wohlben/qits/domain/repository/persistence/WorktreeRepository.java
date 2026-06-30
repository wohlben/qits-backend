package eu.wohlben.qits.domain.repository.persistence;

import eu.wohlben.qits.domain.repository.entity.Worktree;
import eu.wohlben.qits.domain.repository.entity.WorktreeStatus;
import io.quarkus.hibernate.orm.panache.PanacheRepository;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class WorktreeRepository implements PanacheRepository<Worktree> {

  // --- ACTIVE-only (operational) -----------------------------------------------------------------
  // Worktrees are soft-deleted, so resolved rows linger. Everything that operates on a live
  // worktree
  // (terminal, command launch, merge, discard, branch resolution) must use these ACTIVE finders.

  public Optional<Worktree> findActiveByRepositoryAndWorktreeId(
      String repositoryId, String worktreeId) {
    return find(
            "repository.id = ?1 and worktreeId = ?2 and status = ?3",
            repositoryId,
            worktreeId,
            WorktreeStatus.ACTIVE)
        .firstResultOptional();
  }

  public List<Worktree> findActiveByRepositoryId(String repositoryId) {
    return list("repository.id = ?1 and status = ?2", repositoryId, WorktreeStatus.ACTIVE);
  }

  public boolean existsActiveByRepositoryAndWorktreeId(String repositoryId, String worktreeId) {
    return count(
            "repository.id = ?1 and worktreeId = ?2 and status = ?3",
            repositoryId,
            worktreeId,
            WorktreeStatus.ACTIVE)
        > 0;
  }

  // --- Any-status (history / discovery) ----------------------------------------------------------

  /** Every worktree (active + resolved) for a repository, newest first — for the history view. */
  public List<Worktree> findByRepositoryId(String repositoryId) {
    return list("repository.id = ?1 order by id desc", repositoryId);
  }
}
