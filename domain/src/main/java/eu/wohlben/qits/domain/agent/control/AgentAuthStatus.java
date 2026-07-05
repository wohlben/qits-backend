package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Whether the coding agent (Claude Code) has a usable login on the shared credential volume. Runs
 * {@code claude auth status} inside the worktree container with {@code HOME} pointed at the mounted
 * volume, so it reflects the one-time OAuth login an operator did (see {@code
 * docker/workspace/agent-login.sh}). Used by {@link AgentLaunchService} to redirect a chat launch
 * to an interactive {@code claude} REPL terminal (its onboarding paste login) when the agent isn't
 * signed in yet.
 */
@ApplicationScoped
public class AgentAuthStatus {

  @Inject ContainerRuntime containers;

  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  /**
   * Whether the agent is signed in for {@code worktreeId}'s container. A missing container counts
   * as not-signed-in (the caller surfaces the container-missing error on the actual launch).
   */
  public boolean isLoggedIn(String repoId, String worktreeId) {
    String container = containers.containerName(worktreeId, repoId);
    if (!containers.exists(container)) {
      return false;
    }
    ContainerRuntime.ExecResult result =
        containers.exec(
            container, "/workspace", Map.of("HOME", claudeMount), "claude", "auth", "status");
    return parseLoggedIn(result.exitCode(), result.output());
  }

  /**
   * Reads the {@code claude auth status} result. The command prints JSON ({@code {"loggedIn": …}})
   * and exits non-zero when signed out; prefer the explicit field, fall back to the exit code.
   */
  static boolean parseLoggedIn(int exitCode, String output) {
    if (output != null && output.contains("\"loggedIn\"")) {
      String compact = output.replace(" ", "");
      return compact.contains("\"loggedIn\":true");
    }
    return exitCode == 0;
  }
}
