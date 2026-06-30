package eu.wohlben.qits.domain.command.persistence;

import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;

@ApplicationScoped
public class CommandRepository implements PanacheRepositoryBase<Command, String> {

  /** All commands, most-recently-launched first (the Commands list order). */
  public List<Command> listAllByLaunchedAtDesc() {
    return list("order by launchedAt desc");
  }

  public List<Command> findByStatus(CommandStatus status) {
    return list("status = ?1 order by launchedAt desc", status);
  }

  /** Commands whose worktree belongs to {@code repositoryId}, most-recent first. */
  public List<Command> findByRepository(String repositoryId) {
    return list("worktree.repository.id = ?1 order by launchedAt desc", repositoryId);
  }

  /** Commands that ran in a worktree (by surrogate id), in launch order. */
  public List<Command> findByWorktree(Long worktreeId) {
    return list("worktree.id = ?1 order by launchedAt", worktreeId);
  }
}
