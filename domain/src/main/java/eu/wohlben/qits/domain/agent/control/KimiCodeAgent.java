package eu.wohlben.qits.domain.agent.control;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The Kimi Code harness — a {@link CodingAgent} that renders {@code kimi} command lines.
 * Interactive launches spin up a throwaway {@code KIMI_CODE_HOME} (a symlink farm back to the
 * shared volume for credentials/sessions, plus a launch-local {@code mcp.json} and, when session
 * reporting is on, a launch-local {@code config.toml} carrying the SessionStart report hook) and
 * then run {@code kimi} as the script's last command — deliberately not {@code exec}, which would
 * replace the shell and keep the farm's EXIT trap from ever firing. A one-off run uses {@code kimi
 * -p '…' --output-format stream-json}. Kimi ids are {@code session_<uuid>} rather than canonical
 * UUIDs, and fresh sessions cannot be pinned at launch — qits learns the id from the SessionStart
 * hook.
 *
 * <p>Native chat over ACP is deliberately out of scope here; {@link #chat()} throws.
 */
public class KimiCodeAgent extends CodingAgent {

  /** Kimi session ids are {@code session_<uuid>}. */
  private static final String KIMI_SESSION_PATTERN =
      "session_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

  private final ObjectMapper mapper = new ObjectMapper();

  @Override
  protected boolean isSessionIdValid(String value) {
    if (value == null) {
      return true;
    }
    return value.matches(KIMI_SESSION_PATTERN);
  }

  @Override
  protected void validateSessionConfiguration() {
    if (forkRequested) {
      throw new IllegalStateException("Kimi Code does not support fork");
    }
    super.validateSessionConfiguration();
  }

  @Override
  public LaunchSpec start() {
    validateSessionConfiguration();
    StringBuilder script = new StringBuilder();
    appendKimiHomePrelude(script);
    appendMcpConfig(script);
    appendSessionReportHook(script);
    StringBuilder command = new StringBuilder("kimi");
    if (skipPermissions) {
      command.append(" --yolo");
    }
    if (resumeSessionId != null) {
      command.append(" -S ").append(resumeSessionId);
    }
    if (model != null && !model.isBlank()) {
      command.append(" -m ").append(shellQuote(model));
    }
    if (initialContext != null && !initialContext.isBlank()) {
      command.append(' ').append(shellQuote(initialContext));
    }
    script.append('\n').append(command);
    return new LaunchSpec(script.toString(), true, environment);
  }

  @Override
  public LaunchSpec run(String prompt) {
    validateSessionConfiguration();
    StringBuilder script = new StringBuilder();
    appendKimiHomePrelude(script);
    appendMcpConfig(script);
    appendSessionReportHook(script);
    StringBuilder command = new StringBuilder("kimi -p ").append(shellQuote(prompt));
    if (!plainTextOutput) {
      command.append(" --output-format stream-json");
    }
    if (model != null && !model.isBlank()) {
      command.append(" -m ").append(shellQuote(model));
    }
    script.append('\n').append(command);
    return new LaunchSpec(script.toString(), false, environment);
  }

  @Override
  public LaunchSpec chat() {
    throw new UnsupportedOperationException(
        "Kimi Code chat is not implemented yet; it requires the ACP transport");
  }

  /**
   * Renders the per-launch {@code KIMI_CODE_HOME} symlink farm. The container arrives with {@code
   * KIMI_CODE_HOME} pointing at the shared volume ({@code /claude-home/.kimi-code}); we capture
   * that, repoint {@code KIMI_CODE_HOME} at a throwaway dir, and symlink credentials, config,
   * hooks, and the session store back to the volume. The launch-local {@code mcp.json} is written
   * into the throwaway dir so concurrent launches never clobber each other's MCP scope.
   *
   * <p>When session reporting is on, {@code config.toml} is deliberately left out of the farm —
   * {@link #appendSessionReportHook} writes a launch-local copy instead, because the report hook's
   * URL is per-command.
   *
   * <p>The prelude is intentionally self-contained: it makes no assumption about what already
   * exists on the volume beyond the container-set {@code KIMI_CODE_HOME} env var.
   */
  private void appendKimiHomePrelude(StringBuilder script) {
    String farmEntries =
        sessionReportingUrl == null
            ? "config.toml tui.toml credentials oauth device_id"
            : "tui.toml credentials oauth device_id";
    script.append(
        "QITS_KIMI_HOME=\"$KIMI_CODE_HOME\"\n"
            + "export KIMI_CODE_HOME=\"$(mktemp -d /tmp/qits-kimi-XXXXXX)\"\n"
            + "trap 'rm -rf \"$KIMI_CODE_HOME\"' EXIT\n"
            + "for e in "
            + farmEntries
            + "; do\n"
            + "  [ -e \"$QITS_KIMI_HOME/$e\" ] && ln -s \"$QITS_KIMI_HOME/$e\" \"$KIMI_CODE_HOME/$e\"\n"
            + "done\n"
            + "mkdir -p \"$QITS_KIMI_HOME/sessions\"\n"
            + "ln -s \"$QITS_KIMI_HOME/sessions\" \"$KIMI_CODE_HOME/sessions\"\n"
            + "[ -e \"$QITS_KIMI_HOME/session_index.jsonl\" ] || : > \"$QITS_KIMI_HOME/session_index.jsonl\"\n"
            + "ln -s \"$QITS_KIMI_HOME/session_index.jsonl\" \"$KIMI_CODE_HOME/session_index.jsonl\"\n");
  }

  /** Appends the scoped {@code mcp.json} heredoc if any MCP servers are attached. */
  private void appendMcpConfig(StringBuilder script) {
    if (mcpServers.isEmpty()) {
      return;
    }
    Map<String, Object> kimiServers = new LinkedHashMap<>();
    for (Map.Entry<String, Object> entry : mcpServers.entrySet()) {
      String key = entry.getKey();
      @SuppressWarnings("unchecked")
      Map<String, Object> config = (Map<String, Object>) entry.getValue();
      Map<String, Object> kimiConfig = new LinkedHashMap<>(config);
      List<String> enabled = enabledToolsFor(key);
      if (!enabled.isEmpty()) {
        kimiConfig.put("enabledTools", enabled);
      }
      kimiServers.put(key, kimiConfig);
    }
    String json = writeJson(Map.of("mcpServers", kimiServers));
    script.append("\ncat > \"$KIMI_CODE_HOME/mcp.json\" <<'EOF'\n").append(json).append("\nEOF");
  }

  /**
   * Appends the launch-local {@code config.toml} carrying this launch's session-report hook. Kimi's
   * only hook channel is a {@code [[hooks]]} entry in {@code config.toml} — there is no per-launch
   * flag like Claude's {@code --settings} — and the report URL is per-command, so a static
   * volume-level hook can't carry it. Instead the launch copies the volume's {@code config.toml}
   * into the throwaway home and appends its own {@code SessionStart} hook, which POSTs the hook's
   * stdin JSON ({@code {hook_event_name, session_id, cwd}}) to the qits session-report endpoint.
   * Must run after {@link #appendKimiHomePrelude} (it writes into the throwaway home) and before
   * the {@code kimi} invocation.
   */
  private void appendSessionReportHook(StringBuilder script) {
    if (sessionReportingUrl == null) {
      return;
    }
    if (sessionReportingUrl.contains("'")) {
      // Defense in depth: the URL is composed of a resolver host, a port, and a UUID command id,
      // none of which can contain a quote — but it ends up inside a TOML literal string.
      throw new IllegalArgumentException(
          "Session-reporting URL must not contain quotes: " + sessionReportingUrl);
    }
    String post =
        "curl -fsS -m 5 -X POST -H \"Content-Type: application/json\" --data-binary @- "
            + sessionReportingUrl;
    script.append(
        "\n{ [ ! -e \"$QITS_KIMI_HOME/config.toml\" ] || cat \"$QITS_KIMI_HOME/config.toml\"; }"
            + " > \"$KIMI_CODE_HOME/config.toml\"\n");
    script
        .append("cat >> \"$KIMI_CODE_HOME/config.toml\" <<'EOF'\n\n[[hooks]]\n")
        .append("event = \"SessionStart\"\n")
        .append("command = '")
        .append(post)
        .append("'\nEOF");
  }

  /**
   * Kimi's {@code enabledTools} is per-server and takes bare tool names. qits' shared allowlists
   * use the Claude-prefixed {@code mcp__<server>__<tool>} form for every server — strip the prefix
   * for the server we are configuring.
   */
  private List<String> enabledToolsFor(String serverKey) {
    String prefix = "mcp__" + serverKey + "__";
    List<String> result = new ArrayList<>();
    for (String tool : allowedTools) {
      if (tool.startsWith(prefix)) {
        result.add(tool.substring(prefix.length()));
      }
    }
    return result;
  }

  /**
   * Kimi Code persists a session's transcript under {@code
   * $KIMI_CODE_HOME/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl}, where {@code
   * workDirKey} is {@code wd_<basename(cwd)>_<sha256(cwd)[:12]>} — e.g. {@code /workspace} → {@code
   * wd_workspace_c52ddf65534b}. Verified against CLI 0.28.1 and pinned by a regression test (this
   * is NOT Claude's non-alphanumeric→{@code -} escaping, despite the similar purpose).
   */
  @Override
  public Path transcriptPath(String cwd, String sessionId) {
    return Path.of("sessions", workDirKey(cwd), sessionId, "agents", "main", "wire.jsonl");
  }

  /**
   * Subagent sidechains live as sibling {@code agents/<subagentId>/wire.jsonl} files under the same
   * session dir.
   */
  @Override
  public Path subagentsDir(String cwd, String sessionId) {
    return Path.of("sessions", workDirKey(cwd), sessionId, "agents");
  }

  /**
   * Kimi's per-working-directory session bucket: {@code wd_<basename>_<sha256(cwd)[:12]>}. The
   * basename keeps it human-recognizable; the hash of the full path disambiguates same-named dirs
   * (verified: {@code /tmp} → {@code wd_tmp_e9671acd2448}, {@code /tmp/probe-nest/sub} → {@code
   * wd_sub_7e6a66d1ac42}).
   */
  private static String workDirKey(String cwd) {
    String base = Path.of(cwd).getFileName() == null ? "" : Path.of(cwd).getFileName().toString();
    return "wd_" + base + "_" + sha256Hex(cwd).substring(0, 12);
  }

  private static String sha256Hex(String value) {
    try {
      byte[] digest =
          java.security.MessageDigest.getInstance("SHA-256")
              .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      StringBuilder hex = new StringBuilder(digest.length * 2);
      for (byte b : digest) {
        hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
      }
      return hex.toString();
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is required by the platform", e);
    }
  }

  private String writeJson(Object value) {
    try {
      return mapper.writeValueAsString(value);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Failed to render agent config JSON", e);
    }
  }

  private static String shellQuote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }
}
