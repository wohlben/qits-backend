package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * The Claude Code harness — a {@link CodingAgent} that renders its accumulated configuration into a
 * {@code claude} command. Interactive launches {@code exec claude}; a one-off run uses {@code
 * claude -p …}. Attached MCP servers are merged into one {@code --strict-mcp-config --mcp-config
 * '{…}'} and the collected allowlist into a single {@code --allowedTools '…'}; an autonomous run
 * adds {@code --dangerously-skip-permissions}.
 *
 * <p>The initial context / prompt is embedded directly as a shell-quoted argument (single-quoting
 * is injection-safe for any content), so a prompt can come from anywhere the caller reads it — a
 * literal, a classpath resource, an entity — without a side file.
 */
public class ClaudeCodeAgent extends CodingAgent {

  private final ObjectMapper mapper = new ObjectMapper();

  @Override
  public LaunchSpec start() {
    StringBuilder command = new StringBuilder("exec claude");
    if (flatOutput) {
      // --ax-screen-reader renders flat text (no alternate-screen TUI/animations), so the PTY
      // session log captures the readable conversation instead of terminal control sequences that
      // get wiped when the interactive UI exits.
      command.append(" --ax-screen-reader");
    }
    if (initialContext != null && !initialContext.isBlank()) {
      command.append(' ').append(shellQuote(initialContext));
    }
    appendFlags(command);
    return new LaunchSpec(command.toString(), true, environment);
  }

  @Override
  public LaunchSpec run(String prompt) {
    StringBuilder command = new StringBuilder("claude -p ").append(shellQuote(prompt));
    appendFlags(command);
    return new LaunchSpec(command.toString(), false, environment);
  }

  @Override
  public LaunchSpec chat() {
    // Bidirectional stream-json: user messages are fed on stdin as JSON, structured events
    // (assistant
    // messages, tool calls, result) come back on stdout — driven programmatically over plain pipes,
    // not a PTY. --verbose emits every event, not just the final result. --include-hook-events
    // surfaces hook lifecycle events (e.g. Stop) in the stream, giving qits turn-boundary
    // awareness for busy/idle detection and well-timed daemon-event injection. exec'd because the
    // process is long-lived and managed.
    StringBuilder command =
        new StringBuilder(
            "exec claude --print --input-format stream-json --output-format stream-json"
                + " --include-hook-events --verbose");
    appendFlags(command);
    return new LaunchSpec(command.toString(), false, environment);
  }

  /**
   * Appends the session flags, the model, the MCP config, the allowlist, the session-report hook
   * and the skip-permissions flag.
   */
  private void appendFlags(StringBuilder command) {
    validateSessionConfiguration();
    if (resumeSessionId != null) {
      command.append(" --resume ").append(resumeSessionId);
      if (forkRequested) {
        command.append(" --fork-session --session-id ").append(sessionId);
      }
    } else if (sessionId != null) {
      command.append(" --session-id ").append(sessionId);
    }
    if (model != null && !model.isBlank()) {
      command.append(" --model ").append(shellQuote(model));
    }
    if (!mcpServers.isEmpty()) {
      String json = writeJson(Map.of("mcpServers", mcpServers));
      command.append(" --strict-mcp-config --mcp-config ").append(shellQuote(json));
    }
    if (!allowedTools.isEmpty()) {
      command.append(" --allowedTools ").append(shellQuote(String.join(",", allowedTools)));
    }
    if (sessionReportingUrl != null) {
      command.append(" --settings ").append(shellQuote(writeJson(sessionReportSettings())));
    }
    if (skipPermissions) {
      command.append(" --dangerously-skip-permissions");
    }
  }

  /**
   * A settings layer whose {@code SessionStart} hook POSTs the hook's stdin JSON ({@code {source,
   * session_id, transcript_path, …}}) to the qits session-report endpoint. SessionStart fires on
   * {@code startup}/{@code resume}/{@code clear}/{@code compact}, so qits learns the live session
   * whenever it changes underneath a running process — not just at launch.
   */
  private Map<String, Object> sessionReportSettings() {
    if (sessionReportingUrl.contains("'")) {
      // Defense in depth: the URL is composed of a resolver host, a port, and a UUID command id,
      // none of which can contain a quote — but it ends up inside a single-quoted argv.
      throw new IllegalArgumentException(
          "Session-reporting URL must not contain quotes: " + sessionReportingUrl);
    }
    String post =
        "curl -fsS -m 5 -X POST -H \"Content-Type: application/json\" --data-binary @- "
            + sessionReportingUrl;
    return Map.of(
        "hooks",
        Map.of(
            "SessionStart",
            List.of(Map.of("hooks", List.of(Map.of("type", "command", "command", post))))));
  }

  /**
   * Claude Code persists a session's transcript under {@code
   * $CLAUDE_CONFIG_DIR/projects/<escaped-cwd>/<sessionId>.jsonl}, where the escaped cwd replaces
   * every non-alphanumeric character with {@code -} (verified against CLI 2.1.204, the pinned image
   * version; a regression IT re-checks the convention when the pin moves).
   */
  @Override
  public Path transcriptPath(String cwd, String sessionId) {
    return Path.of("projects", escapeCwd(cwd), sessionId + ".jsonl");
  }

  /**
   * Task-tool subagents persist beside the main JSONL: {@code
   * projects/<escaped-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl} plus a sibling {@code
   * agent-<agentId>.meta.json} carrying {@code {agentType, description, toolUseId, spawnDepth}}.
   */
  @Override
  public Path subagentsDir(String cwd, String sessionId) {
    return Path.of("projects", escapeCwd(cwd), sessionId, "subagents");
  }

  private static String escapeCwd(String cwd) {
    return cwd.replaceAll("[^A-Za-z0-9]", "-");
  }

  private String writeJson(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to render agent config JSON", e);
    }
  }

  /**
   * POSIX single-quoting: safe for any content, since only {@code '} is special inside {@code '…'}.
   */
  private static String shellQuote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }
}
