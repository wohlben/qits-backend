package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.control.CommandService.RunOutcome;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Runs a <em>non-interactive</em> action (a one-off command such as {@code mvn test}) to completion
 * in a workspace checkout and returns its combined output and exit code. This is now a thin adapter
 * over {@link CommandService#launchAndAwait}: the run is launched as a registry command (so it is
 * recorded and shows up in the Commands list), and this method blocks for its result. The action is
 * resolved against the repository's effective set and rejected if it is interactive — all of which
 * {@code CommandService} enforces.
 */
@ApplicationScoped
public class ActionRunService {

  @Inject CommandService commandService;

  /** The outcome of running an action: the combined stdout/stderr and the process exit code. */
  public record RunResult(String actionId, String name, int exitCode, String output) {}

  /** Runs {@code actionId} in {@code repoId}/{@code workspaceId} to completion. */
  public RunResult run(String repoId, String workspaceId, String actionId) {
    RunOutcome outcome = commandService.launchAndAwait(repoId, workspaceId, actionId);
    return new RunResult(
        outcome.actionId(), outcome.actionName(), outcome.exitCode(), outcome.output());
  }
}
