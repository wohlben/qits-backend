package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.repository.control.ContainerRuntime;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Whether the configured coding agent has a usable login on the shared credential volume. For
 * Claude Code this runs {@code claude auth status}; for Kimi Code it probes credential-file
 * presence under the real volume home. Used by {@link AgentLaunchService} to redirect a launch to
 * an interactive login terminal when the agent isn't signed in yet.
 */
@ApplicationScoped
public class AgentAuthStatus {

  @Inject ContainerRuntime containers;

  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  @ConfigProperty(name = "qits.agent.type", defaultValue = "claude")
  AgentType agentType;

  /**
   * Whether the agent is signed in for {@code workspaceId}'s container. A missing container counts
   * as not-signed-in (the caller surfaces the container-missing error on the actual launch).
   */
  public boolean isLoggedIn(String repoId, String workspaceId) {
    String container = containers.containerName(workspaceId, repoId);
    if (!containers.exists(container)) {
      return false;
    }
    return switch (agentType) {
      case CLAUDE -> probeClaude(container);
      case KIMI -> probeKimi(container);
    };
  }

  private boolean probeClaude(String container) {
    ContainerRuntime.ExecResult result =
        containers.exec(
            container, "/workspace", Map.of("HOME", claudeMount), "claude", "auth", "status");
    return parseClaudeLoggedIn(result.exitCode(), result.output());
  }

  private boolean probeKimi(String container) {
    String kimiHome = claudeMount + "/.kimi-code";
    ContainerRuntime.ExecResult result =
        containers.exec(
            container,
            "/workspace",
            Map.of("KIMI_CODE_HOME", kimiHome),
            "bash",
            "-c",
            "test -f \"$KIMI_CODE_HOME/credentials\"");
    return result.exitCode() == 0;
  }

  /**
   * Reads the {@code claude auth status} result. The command prints JSON ({@code {"loggedIn": …}})
   * and exits non-zero when signed out; prefer the explicit field, fall back to the exit code.
   */
  static boolean parseClaudeLoggedIn(int exitCode, String output) {
    if (output != null && output.contains("\"loggedIn\"")) {
      String compact = output.replace(" ", "");
      return compact.contains("\"loggedIn\":true");
    }
    return exitCode == 0;
  }
}
