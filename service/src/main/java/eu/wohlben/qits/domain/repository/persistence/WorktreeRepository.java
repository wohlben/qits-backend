package eu.wohlben.qits.domain.repository.persistence;

import eu.wohlben.qits.domain.repository.entity.Worktree;
import io.quarkus.hibernate.orm.panache.PanacheRepository;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class WorktreeRepository implements PanacheRepository<Worktree> {

    public Optional<Worktree> findByRepositoryAndWorktreeId(String repositoryId, String worktreeId) {
        return find("repository.id = ?1 and worktreeId = ?2", repositoryId, worktreeId).firstResultOptional();
    }

    public List<Worktree> findByRepositoryId(String repositoryId) {
        return list("repository.id", repositoryId);
    }

    public boolean existsByRepositoryAndWorktreeId(String repositoryId, String worktreeId) {
        return count("repository.id = ?1 and worktreeId = ?2", repositoryId, worktreeId) > 0;
    }
}
