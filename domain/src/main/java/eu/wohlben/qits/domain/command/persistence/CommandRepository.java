package eu.wohlben.qits.domain.command.persistence;

import eu.wohlben.qits.domain.command.entity.Command;
import eu.wohlben.qits.domain.command.entity.CommandKind;
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

  /** Commands whose workspace belongs to {@code repositoryId}, most-recent first. */
  public List<Command> findByRepository(String repositoryId) {
    return list("workspace.repository.id = ?1 order by launchedAt desc", repositoryId);
  }

  /** Commands that ran in a workspace (by surrogate id), in launch order. */
  public List<Command> findByWorkspace(Long workspaceId) {
    return list("workspace.id = ?1 order by launchedAt", workspaceId);
  }

  /**
   * RUNNING commands of {@code kind} in a workspace (by repository id + workspace slug), newest
   * first — the server-side twin of the frontend's newest-running-chat resolution rule.
   */
  public List<Command> findRunningByKindAndWorkspace(
      CommandKind kind, String repositoryId, String workspaceId) {
    return list(
        "kind = ?1 and status = ?2 and workspace.repository.id = ?3 and workspace.workspaceId = ?4"
            + " order by launchedAt desc",
        kind,
        CommandStatus.RUNNING,
        repositoryId,
        workspaceId);
  }
}
