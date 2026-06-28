package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.InternalServerErrorException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService.ResolvedAction;
import eu.wohlben.qits.domain.repository.persistence.WorktreeRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Runs a <em>non-interactive</em> action (a one-off command such as {@code mvn test}) to completion
 * in a worktree checkout and returns its combined output and exit code. The action is resolved
 * against the repository's effective set (global + repository-owned). This is the one-off
 * counterpart to the interactive terminal ({@code TerminalSocket}): the script runs through a login
 * shell ({@code /bin/bash -lc}) in the worktree directory, with the action's environment overlaid
 * on the inherited one, and the process is awaited (no stdin attached).
 *
 * <p>Like the worktree git operations, the read + execution happen inside one transaction (the
 * service shells out to a subprocess the same way {@code WorktreeService} shells out to git).
 */
@ApplicationScoped
public class ActionRunService {

  /** How long a single action may run before it is killed and reported as a timeout. */
  private static final long TIMEOUT_MINUTES = 10;

  @Inject ActionResolutionService actionResolutionService;

  @Inject WorktreeRepository worktreeRepository;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  /** The outcome of running an action: the combined stdout/stderr and the process exit code. */
  public record RunResult(String actionId, String name, int exitCode, String output) {}

  /**
   * Runs {@code actionId} in {@code repoId}/{@code worktreeId}. Validates that the worktree belongs
   * to the repository and exists on disk; resolves the action against the repository's effective
   * set (global + repository-owned), so a repository action from another repo is rejected; and
   * requires it to be non-interactive (interactive actions are for the human terminal, not a
   * one-off run).
   */
  @Transactional
  public RunResult run(String repoId, String worktreeId, String actionId) {
    // Never build a filesystem path from unvalidated input: the worktree must be a known row for
    // this repo (this also rejects path-traversal attempts in worktreeId).
    if (!worktreeRepository.existsByRepositoryAndWorktreeId(repoId, worktreeId)) {
      throw new NotFoundException("Worktree not found: " + worktreeId);
    }

    ResolvedAction action = actionResolutionService.resolveForRepository(repoId, actionId);
    if (action.interactive()) {
      throw new BadRequestException(
          "Action '"
              + action.name()
              + "' is interactive — run it from the Run… terminal, not as a one-off command.");
    }

    Path worktreePath = Path.of(dataDir, repoId, "worktrees", worktreeId).toAbsolutePath();
    if (!Files.exists(worktreePath)) {
      throw new BadRequestException("Worktree checkout missing on disk");
    }

    return execute(action, worktreePath);
  }

  private RunResult execute(ResolvedAction action, Path worktreePath) {
    ProcessBuilder pb = new ProcessBuilder("/bin/bash", "-lc", action.executeScript());
    pb.directory(worktreePath.toFile());
    // ProcessBuilder.environment() starts from the inherited env; overlay the action's overrides.
    pb.environment().putAll(action.environment());
    pb.redirectErrorStream(true);

    try {
      Process process = pb.start();

      // Drain output on a daemon thread so a chatty process never deadlocks on a full pipe while we
      // wait. join() after waitFor establishes a happens-before, so the collected text is visible.
      StringBuilder out = new StringBuilder();
      Thread reader =
          new Thread(
              () -> {
                try (BufferedReader r =
                    new BufferedReader(
                        new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                  String line;
                  while ((line = r.readLine()) != null) {
                    out.append(line).append('\n');
                  }
                } catch (Exception ignored) {
                  // The process is ending; whatever we captured is what we report.
                }
              },
              "action-run-" + action.id());
      reader.setDaemon(true);
      reader.start();

      boolean finished = process.waitFor(TIMEOUT_MINUTES, TimeUnit.MINUTES);
      if (!finished) {
        process.destroyForcibly();
        reader.join(TimeUnit.SECONDS.toMillis(2));
        throw new InternalServerErrorException(
            "Action '" + action.name() + "' timed out after " + TIMEOUT_MINUTES + " minutes");
      }
      reader.join(TimeUnit.SECONDS.toMillis(5));

      return new RunResult(
          action.id(), action.name(), process.exitValue(), out.toString().stripTrailing());
    } catch (java.io.IOException e) {
      throw new InternalServerErrorException(
          "Failed to start action '" + action.name() + "': " + e.getMessage());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new InternalServerErrorException(
          "Interrupted while running action '" + action.name() + "'");
    }
  }
}
