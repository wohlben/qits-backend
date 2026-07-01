package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
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

  /** Appends the MCP config, the allowlist and the skip-permissions flag when configured. */
  private void appendFlags(StringBuilder command) {
    if (!mcpServers.isEmpty()) {
      String json = writeJson(Map.of("mcpServers", mcpServers));
      command.append(" --strict-mcp-config --mcp-config ").append(shellQuote(json));
    }
    if (!allowedTools.isEmpty()) {
      command.append(" --allowedTools ").append(shellQuote(String.join(",", allowedTools)));
    }
    if (skipPermissions) {
      command.append(" --dangerously-skip-permissions");
    }
  }

  private String writeJson(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to render MCP config", e);
    }
  }

  /**
   * POSIX single-quoting: safe for any content, since only {@code '} is special inside {@code '…'}.
   */
  private static String shellQuote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }
}
