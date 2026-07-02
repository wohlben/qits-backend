package eu.wohlben.qits.domain.agent.control;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A pluggable coding-agent harness, configured fluently and rendered to a launch command. This base
 * class <em>is</em> the builder: it holds the common, harness-agnostic configuration (MCP servers,
 * a tool allowlist, an initial prompt, whether to skip permission prompts) and exposes the fluent
 * setters, so a concrete agent only has to know how to turn that configuration into <em>its
 * own</em> command line. Obtain one via {@link CodingAgentFactory#ofType}.
 *
 * <pre>{@code
 * LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE)
 *     .mcpServer("repository", McpServers.httpMcp(scopedUrl))
 *     .allowedTools(READ_ONLY_REPOSITORY_TOOLS)
 *     .initialContext(seed)
 *     .start();
 * }</pre>
 *
 * <p>Rendering never spawns a process — {@link #start()}/{@link #run(String)} return a {@link
 * LaunchSpec} the command registry executes. Plain framework-free Java (no CDI), so it is trivially
 * unit-testable. {@code ClaudeCodeAgent} is the only implementation today.
 */
public abstract class CodingAgent {

  /** Attached MCP servers as {@code key → config}; insertion-ordered for deterministic output. */
  protected final Map<String, Object> mcpServers = new LinkedHashMap<>();

  /** Tools pre-approved across all attached servers (an agent renders these however it must). */
  protected final List<String> allowedTools = new ArrayList<>();

  /** Environment overlay for the launched process. */
  protected final Map<String, String> environment = new HashMap<>();

  /** The interactive seed prompt, or null. */
  protected String initialContext;

  /** Model override for the launched session, or null for the harness default. */
  protected String model;

  /** Whether to run without permission prompts. */
  protected boolean skipPermissions;

  /**
   * Whether an interactive session renders flat text instead of a full-screen TUI (default false).
   * Off everywhere for now; enable per-launch with {@link #flatOutput()} when a readable captured
   * session log matters more than the interactive UI.
   */
  protected boolean flatOutput;

  /** Attaches an MCP server under {@code key} with a harness-agnostic {@link McpServers} config. */
  public CodingAgent mcpServer(String key, Object config) {
    this.mcpServers.put(key, config);
    return this;
  }

  /** Pre-approves these tools so the session can use them without a permission prompt. */
  public CodingAgent allowedTools(Collection<String> tools) {
    this.allowedTools.addAll(tools);
    return this;
  }

  /** Seeds an interactive session with a first prompt (only used by {@link #start()}). */
  public CodingAgent initialContext(String context) {
    this.initialContext = context;
    return this;
  }

  /** Pins the session to a specific model (a harness-specific id or alias, e.g. "haiku"). */
  public CodingAgent model(String model) {
    this.model = model;
    return this;
  }

  /** Overlays an environment variable on the launched process. */
  public CodingAgent environment(String key, String value) {
    this.environment.put(key, value);
    return this;
  }

  /** Runs without permission prompts. */
  public CodingAgent skipPermissions() {
    this.skipPermissions = true;
    return this;
  }

  /**
   * Renders an interactive session as flat text (no full-screen TUI/animations), so a captured PTY
   * session log stays readable. Off by default.
   */
  public CodingAgent flatOutput() {
    this.flatOutput = true;
    return this;
  }

  /** Renders the configured agent as an interactive launch (a human attaches a terminal). */
  public abstract LaunchSpec start();

  /** Renders the configured agent as a one-off launch that runs {@code prompt} to completion. */
  public abstract LaunchSpec run(String prompt);

  /**
   * Renders the configured agent as a bidirectional streaming chat session: user messages in and
   * structured events out over stdin/stdout (stream-json), driven programmatically over plain
   * pipes.
   */
  public abstract LaunchSpec chat();
}
