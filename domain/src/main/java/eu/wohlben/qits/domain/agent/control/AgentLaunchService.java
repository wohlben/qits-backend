package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.command.control.CommandExitListener;
import eu.wohlben.qits.domain.command.control.CommandRegistry;
import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.AgentSessionRef;
import eu.wohlben.qits.domain.command.entity.AgentSessionSource;
import eu.wohlben.qits.domain.command.persistence.CommandRepository;
import eu.wohlben.qits.domain.daemon.control.DaemonEventSpool;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.QitsHostResolver;
import eu.wohlben.qits.domain.repository.control.WorkspacePromptDraftService;
import eu.wohlben.qits.domain.repository.control.WorkspaceService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Launches a coding agent (Claude Code or Kimi Code) into a workspace with an MCP server attached,
 * scoped to the repository or project it runs in. This is the separate "agent code path" that
 * replaced the old {@code CLAUDE_*} action variants: it renders the launch with {@link
 * CodingAgentFactory}, writes any seed prompt into the workspace, and spawns it as a registry
 * {@link CommandDto} — so an agent session still shows up in the Commands list and is
 * attachable/terminable like any other command.
 *
 * <p>Owns the MCP scope→URL construction (the read-only allowlists and the {@code ?repositoryId=} /
 * {@code ?projectId=} query params) that used to live in {@code ActionResolutionService}. Scope ids
 * are validated as UUIDs before being interpolated into the (single-quoted) launch args, since the
 * agent renderer does no escaping of its own.
 */
@ApplicationScoped
public class AgentLaunchService {

  private static final Logger LOG = Logger.getLogger(AgentLaunchService.class);

  /** Repository and project ids are generated UUIDs; only hex and dashes ever appear. */
  private static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F-]{36}");

  /** Workspace ids are path segments, so they must be strict slugs (mirrors WorkspaceService). */
  private static final Pattern WORKSPACE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

  /**
   * The one-sentence bootstrap turn pushed in place of the composed prompt: it carries the user's
   * authority ("do this"), while the {@code taskPrompt} MCP tool carries the content (the refined
   * markdown + attached images). Trivially deliverable in every launch shape — argv for interactive
   * and autonomous, a stream-json turn for chat — which is the whole point of the push→fetch
   * inversion (an image can't ride an argv or a PTY keystroke, but it rides a tool result).
   */
  static final String TASK_PROMPT_BOOTSTRAP =
      "Fetch the current task prompt for this workspace with the taskPrompt tool, then implement what"
          + " it describes.";

  /**
   * The read-only tools of the {@code actions} MCP server, pre-approved so the session can
   * list/inspect actions without a permission prompt. The mutating tools are left out so the agent
   * still prompts before changing anything. Names are the agent's MCP tool ids: {@code
   * mcp__<server>__<tool>}.
   */
  private static final List<String> READ_ONLY_ACTION_TOOLS =
      List.of(
          "mcp__actions__listGlobalActions",
          "mcp__actions__getGlobalAction",
          "mcp__actions__listRepositoryActions",
          "mcp__actions__getRepositoryAction");

  /** The read-only tools of the {@code repository} MCP server, pre-approved the same way. */
  private static final List<String> READ_ONLY_REPOSITORY_TOOLS =
      List.of(
          "mcp__repository__listRepositories",
          "mcp__repository__listBranches",
          "mcp__repository__listWorkspaces",
          "mcp__repository__listCommits",
          "mcp__repository__listCommitChanges",
          "mcp__repository__getCommitFileDiff",
          "mcp__repository__listActions",
          "mcp__repository__taskPrompt",
          "mcp__repository__telemetryErrors",
          "mcp__repository__telemetryTrace",
          "mcp__repository__telemetrySlowSpans",
          "mcp__repository__telemetrySearchLogs",
          "mcp__repository__telemetryMetrics");

  @Inject CommandService commandService;

  @Inject CommandRegistry commandRegistry;

  @Inject RepositoryRepository repositoryRepository;

  @Inject DaemonEventSpool daemonEventSpool;

  @Inject AgentAuthStatus agentAuthStatus;

  @Inject WorkspaceService workspaceService;

  @Inject WorkspacePromptDraftService promptDraftService;

  @Inject QitsHostResolver qitsHostResolver;

  @Inject CommandRepository commandRepository;

  @Inject AgentTranscriptService agentTranscriptService;

  @Inject AgentTranscriptTailService transcriptTailService;

  @ConfigProperty(name = "qits.workspace.qits-port", defaultValue = "8080")
  int qitsPort;

  /**
   * Explicit override for the {@code actions} MCP base URL. Empty by default so the URL is
   * <strong>derived</strong> from {@link QitsHostResolver} + {@link #qitsPort} — the agent runs
   * inside a workspace container, so a {@code localhost} default would resolve to the container's
   * own loopback, not the qits host (see {@code
   * docs/issues/resolved/2026-07-05_agent-mcp-unreachable-from-container.md}). Set only to point
   * the agent at a different qits instance.
   */
  @ConfigProperty(name = "qits.actions-mcp.url")
  Optional<String> actionsMcpUrlOverride;

  /**
   * Explicit override for the {@code repository} MCP base URL; derived like {@link
   * #actionsMcpUrlOverride}.
   */
  @ConfigProperty(name = "qits.repository-mcp.url")
  Optional<String> repositoryMcpUrlOverride;

  /**
   * Where the shared agent-credential volume mounts in the container (mirrors {@code
   * qits.workspace.claude-mount}). Agent launches point {@code HOME} here so the in-container
   * {@code claude} reads the one-time OAuth login off the volume instead of a per-session secret —
   * the one credential that crosses into the sandbox. Blank leaves {@code HOME} at the image
   * default.
   */
  @ConfigProperty(name = "qits.workspace.claude-mount", defaultValue = "/claude-home")
  String claudeMount;

  /** Which coding-agent harness this qits deployment launches (one harness per deployment). */
  @ConfigProperty(name = "qits.agent.type", defaultValue = "claude")
  AgentType agentType;

  /**
   * Launches the active coding agent as a stream-json <strong>chat</strong> command in {@code
   * workspaceId} of {@code repoId}, with the MCP server(s) for {@code scope} attached. The session
   * is rendered as a conversation and tracked in the command registry (re-attachable, logged).
   * Tools run auto-approved. Returns the spawned command.
   *
   * <p>Kimi Code does not support native chat yet; launching chat under {@code
   * qits.agent.type=kimi} throws {@link BadRequestException}.
   */
  public CommandDto launchChat(
      String repoId, String workspaceId, AgentMcpScope scope, String initialContext) {
    return launchChat(repoId, workspaceId, scope, initialContext, null, false, false);
  }

  /**
   * {@link #launchChat} with session lineage: a non-null {@code resumeSessionId} continues that
   * session (it must belong to this workspace); {@code fork} additionally branches it into a fresh
   * qits-pinned id. With neither, a fresh session id is pinned. Every launch records its first
   * {@link AgentSessionRef} on the command row and carries the session-report hook.
   *
   * <p>When {@code deliverTaskPrompt} is set and the workspace has a composed draft, the seed is
   * the one-sentence {@link #TASK_PROMPT_BOOTSTRAP} (the agent fetches the real prompt over MCP)
   * rather than the caller's {@code initialContext}, and the run is recorded on the draft. With it
   * unset the legacy literal push of {@code initialContext} is unchanged.
   */
  public CommandDto launchChat(
      String repoId,
      String workspaceId,
      AgentMcpScope scope,
      String initialContext,
      String resumeSessionId,
      boolean fork,
      boolean deliverTaskPrompt) {
    if (agentType == AgentType.KIMI) {
      throw new BadRequestException(
          "Kimi Code chat is not implemented yet; use interactive or autonomous launches");
    }
    if (scope == null) {
      throw new BadRequestException("scope is required");
    }
    if (!WORKSPACE_ID_PATTERN.matcher(workspaceId == null ? "" : workspaceId).matches()) {
      throw new BadRequestException("Invalid workspace id: " + workspaceId);
    }
    // Guard the repo id (a UUID) before ensureContainer, so a bad id is a 400 here rather than a
    // 404 "workspace not found" from the lookup below.
    requireUuid(repoId, "repository id");

    // Re-provision a lost container up front so the sign-in probe below runs against a live
    // container (a stopped one would read as not-signed-in and wrongly redirect to login, even
    // though the credentials live on the shared volume). Also lets a missing branch fail loudly.
    workspaceService.ensureContainer(repoId, workspaceId);

    // The agent can't authenticate until an operator has signed in on the shared credential volume.
    // When it hasn't, launch an interactive agent REPL terminal instead — the caller redirects to
    // its command page (a real PTY), the operator finishes OAuth through the REPL onboarding there,
    // and the next chat launch (this workspace or any other, same volume) sees the login and
    // proceeds.
    if (!agentAuthStatus.isLoggedIn(repoId, workspaceId)) {
      return launchLogin(repoId, workspaceId);
    }

    PinnedSession pinned = pinSession(repoId, workspaceId, resumeSessionId, fork);
    LaunchSpec spec = renderChat(repoId, workspaceId, scope, pinned);

    CommandDto command =
        commandService.launchChat(
            repoId,
            workspaceId,
            nameFor(scope),
            spec.script(),
            spec.environment(),
            pinned.commandId(),
            pinned.ref(),
            chatTranscriptSweep());
    // The live transcript import: the durable head a mid-run re-attach replays from.
    transcriptTailService.startTail(command.id());
    boolean deliverBootstrap = shouldDeliverBootstrap(deliverTaskPrompt, repoId, workspaceId);
    String seed = deliverBootstrap ? TASK_PROMPT_BOOTSTRAP : initialContext;
    if (seed != null && !seed.isBlank()) {
      // Seed the conversation as the first user turn. A stream-json chat only speaks over stdin,
      // so the seed can't be a CLI argument; the pipe buffers it until claude starts reading.
      commandRegistry.chatSend(command.id(), seed);
    }
    recordDelivery(deliverBootstrap, repoId, workspaceId, command.id());
    // Daemon events that fired while no chat was running land in the new session right after the
    // seed prompt, so the agent starts with the workspace's recent daemon history.
    List<String> spooledEvents = daemonEventSpool.drain(repoId, workspaceId);
    if (!spooledEvents.isEmpty()) {
      commandRegistry.chatSend(command.id(), String.join("\n\n", spooledEvents));
    }
    return command;
  }

  /**
   * Spawns an autonomous, one-shot Claude run ({@code claude -p '…'
   * --dangerously-skip-permissions}) that <strong>fetches</strong> its task over MCP: the narrowed
   * repository server is attached and the argv prompt is the {@link #TASK_PROMPT_BOOTSTRAP} turn,
   * so the run reads the workspace's composed draft (which the caller must persist first) via
   * {@code taskPrompt}. Used by composed flows such as conflict resolution. Returns the spawned
   * command.
   */
  public CommandDto launchAutonomous(String repoId, String workspaceId, String name) {
    PinnedSession pinned = pinSession(repoId, workspaceId, null, false);
    LaunchSpec spec = renderAutonomous(repoId, workspaceId, AgentMcpScope.REPOSITORY, pinned);
    CommandDto command =
        commandService.launchAgent(
            repoId,
            workspaceId,
            name,
            spec.script(),
            true,
            spec.environment(),
            pinned.commandId(),
            pinned.ref(),
            transcriptSweep());
    // Autonomous always renders the bootstrap turn; recordRun is a no-op when the workspace has no
    // draft row, so it needs no separate deliverability probe (the resolution caller persists one).
    recordDelivery(true, repoId, workspaceId, command.id());
    return command;
  }

  /**
   * Launches the full interactive agent TUI (the plain {@code claude} or {@code kimi} REPL in
   * xterm.js, kind {@code TERMINAL}) as a first-class agent session: same MCP scope servers,
   * credential overlay and skip-permissions as chat, plus a session id and the session-report hook
   * — so the run is resumable, forkable (Claude only), and its transcript is imported on exit like
   * any chat. The PTY byte stream stays terminal-only; the structured conversation comes from the
   * transcript.
   */
  public CommandDto launchInteractive(
      String repoId,
      String workspaceId,
      AgentMcpScope scope,
      String initialContext,
      String resumeSessionId,
      boolean fork,
      boolean deliverTaskPrompt) {
    if (agentType == AgentType.KIMI && fork) {
      throw new BadRequestException("fork is not supported by Kimi Code");
    }
    if (scope == null) {
      throw new BadRequestException("scope is required");
    }
    if (!WORKSPACE_ID_PATTERN.matcher(workspaceId == null ? "" : workspaceId).matches()) {
      throw new BadRequestException("Invalid workspace id: " + workspaceId);
    }
    requireUuid(repoId, "repository id");

    // Same auth gate as chat: without the shared-volume login, redirect to the sign-in REPL.
    workspaceService.ensureContainer(repoId, workspaceId);
    if (!agentAuthStatus.isLoggedIn(repoId, workspaceId)) {
      return launchLogin(repoId, workspaceId);
    }

    // Decide the seed before rendering: the argv prompt is either the bootstrap turn (agent fetches
    // over MCP) when a draft exists, or the caller's literal initialContext.
    boolean deliverBootstrap = shouldDeliverBootstrap(deliverTaskPrompt, repoId, workspaceId);
    String seed = deliverBootstrap ? TASK_PROMPT_BOOTSTRAP : initialContext;

    PinnedSession pinned = pinSession(repoId, workspaceId, resumeSessionId, fork);
    LaunchSpec spec = renderInteractive(repoId, workspaceId, scope, seed, pinned);
    CommandDto command =
        commandService.launchAgent(
            repoId,
            workspaceId,
            interactiveNameFor(scope),
            spec.script(),
            true,
            spec.environment(),
            pinned.commandId(),
            pinned.ref(),
            transcriptSweep());
    recordDelivery(deliverBootstrap, repoId, workspaceId, command.id());
    return command;
  }

  /**
   * Launches an interactive agent login terminal (a normal PTY command, kind {@code TERMINAL}) in
   * the workspace's container so an operator can complete the one-time sign-in (Claude: OAuth
   * through the REPL onboarding; Kimi: the device-code flow). Writes to the shared credential
   * volume, so it signs in every workspace at once. Returned by {@link #launchChat} when the agent
   * isn't signed in yet; the caller redirects to its terminal.
   */
  public CommandDto launchLogin(String repoId, String workspaceId) {
    LaunchSpec spec = renderLogin();
    String name =
        switch (agentType) {
          case CLAUDE -> "Claude sign-in";
          case KIMI -> "Kimi sign-in";
        };
    return commandService.launchAgent(
        repoId, workspaceId, name, spec.script(), true, spec.environment());
  }

  /** Renders the interactive login command with the shared-volume credential overlay. */
  LaunchSpec renderLogin() {
    Map<String, String> env = new HashMap<>();
    if (claudeMount != null && !claudeMount.isBlank()) {
      switch (agentType) {
        case CLAUDE -> env.put("HOME", claudeMount);
        // Kimi uses KIMI_CODE_HOME, set at the container level; login must run against the real
        // volume home (no per-launch mktemp farm) so credential writes survive.
        case KIMI -> env.put("KIMI_CODE_HOME", claudeMount + "/.kimi-code");
      }
    }
    return switch (agentType) {
      case CLAUDE ->
          // Run the `claude` REPL, NOT the `claude auth login` subcommand. The REPL's first-run
          // onboarding renders a paste-the-code prompt over the PTY and reads it from stdin, so an
          // operator can complete sign-in in the terminal. The `auth login` subcommand blocks on a
          // loopback HTTP callback the host browser can never reach. See the resolved issue doc.
          new LaunchSpec("exec claude", true, env);
      case KIMI ->
          // Kimi login is a device-code flow that prints the verification URL + user code and
          // polls,
          // so it works plainly over a TTY.
          new LaunchSpec("exec kimi login", true, env);
    };
  }

  /**
   * A launch's session identity, generated before anything exists: the command id (rendered into
   * the session-report hook URL) and the first {@link AgentSessionRef} of its session list.
   */
  record PinnedSession(String commandId, AgentSessionRef ref) {}

  /**
   * Pins the launch's session identity. Fresh launches pin a brand-new UUID ({@code PINNED}); Kimi
   * Code cannot pin a fresh session id, so its fresh launches return a {@code null} ref and qits
   * learns the id from the harness's SessionStart hook. Resume reuses {@code resumeSessionId} in
   * place ({@code RESUMED}); fork branches it into a fresh pin ({@code FORKED}, with the origin
   * recorded). Resume/fork require the session to belong to this workspace — iteration one keeps
   * lineage where the transcript's file references and git state live. A retried launch pins fresh
   * ids (pinned ids are create-only).
   */
  PinnedSession pinSession(
      String repoId, String workspaceId, String resumeSessionId, boolean fork) {
    String commandId = UUID.randomUUID().toString();
    if (resumeSessionId == null) {
      if (fork) {
        throw new BadRequestException("fork requires resumeSessionId");
      }
      if (agentType == AgentType.KIMI) {
        // Kimi cannot pin a new session id; the SessionStart hook will report it later.
        return new PinnedSession(commandId, null);
      }
      return new PinnedSession(
          commandId,
          new AgentSessionRef(
              UUID.randomUUID().toString(), AgentSessionSource.PINNED, null, null, Instant.now()));
    }
    requireSessionId(resumeSessionId, "session id");
    boolean owned =
        QuarkusTransaction.requiringNew()
            .call(
                () ->
                    commandRepository.existsByWorkspaceAndSessionId(
                        repoId, workspaceId, resumeSessionId));
    if (!owned) {
      throw new BadRequestException(
          "Session " + resumeSessionId + " does not belong to workspace " + workspaceId);
    }
    if (fork) {
      if (agentType == AgentType.KIMI) {
        throw new BadRequestException("fork is not supported by Kimi Code");
      }
      return new PinnedSession(
          commandId,
          new AgentSessionRef(
              UUID.randomUUID().toString(),
              AgentSessionSource.FORKED,
              resumeSessionId,
              null,
              Instant.now()));
    }
    return new PinnedSession(
        commandId,
        new AgentSessionRef(
            resumeSessionId, AgentSessionSource.RESUMED, null, null, Instant.now()));
  }

  private void requireSessionId(String value, String label) {
    if (agentType == AgentType.KIMI) {
      if (value == null
          || !value.matches(
              "session_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
        throw new BadRequestException("Invalid " + label + ": " + value);
      }
      return;
    }
    requireUuid(value, label);
  }

  /**
   * Whether this launch should push the bootstrap turn: the caller asked ({@code
   * deliverTaskPrompt}) and the workspace actually has a draft {@code taskPrompt} would serve. The
   * single decision point for chat and interactive, so the seed choice can't drift between them.
   */
  private boolean shouldDeliverBootstrap(
      boolean deliverTaskPrompt, String repoId, String workspaceId) {
    if (!deliverTaskPrompt) {
      return false;
    }
    boolean deliverable = promptDraftService.hasDeliverablePrompt(repoId, workspaceId);
    if (!deliverable) {
      // The caller asked to hand the composed prompt over the fetch path, but nothing is there to
      // serve (no serialized prompt, no attachments) — e.g. the draft was deleted between the
      // pre-launch flush and here. Without a legacy initialContext the session would start with no
      // seed at all; log it so that silent no-task launch is diagnosable instead of a mystery.
      LOG.warnf(
          "Task-prompt delivery requested for workspace %s but no deliverable prompt exists;"
              + " the session starts without a seed",
          workspaceId);
    }
    return deliverable;
  }

  /**
   * Records, after a delivering launch, which draft version the run was handed — keyed by the
   * command that owns its session. No-op when {@code delivered} is false; {@code recordRun} itself
   * is a no-op when the workspace has no draft row.
   */
  private void recordDelivery(
      boolean delivered, String repoId, String workspaceId, String commandId) {
    if (delivered) {
      promptDraftService.recordRun(repoId, workspaceId, commandId);
    }
  }

  /** Configures the agent's session flags + report hook from the pinned identity. */
  private CodingAgent withSession(CodingAgent agent, PinnedSession pinned) {
    AgentSessionRef ref = pinned.ref();
    if (ref != null) {
      switch (ref.source) {
        case PINNED -> agent.sessionId(ref.sessionId);
        case RESUMED -> agent.resume(ref.sessionId);
        case FORKED -> agent.resume(ref.forkedFromSessionId).fork(ref.sessionId);
        case SWITCHED, REPORTED ->
            throw new IllegalStateException(
                "SWITCHED/REPORTED are hook-reported, never a launch source");
      }
    }
    return agent.sessionReporting(sessionReportUrl(pinned.commandId()));
  }

  /**
   * The container-reachable session-report endpoint for {@code commandId} — the SessionStart hook
   * POSTs its stdin JSON here (composed exactly like {@link #derivedMcpUrl}).
   */
  private String sessionReportUrl(String commandId) {
    return "http://"
        + qitsHostResolver.qitsHost()
        + ":"
        + qitsPort
        + "/api/commands/"
        + commandId
        + "/agent-session";
  }

  /** The post-exit transcript import, composed onto the registry exit listener at spawn. */
  private CommandExitListener transcriptSweep() {
    // onCommandExit swallows its own failures, so the sweep can never break exit handling.
    return (commandId, exitCode, terminatedManually) ->
        agentTranscriptService.onCommandExit(commandId);
  }

  /**
   * The chat exit chain: stop the live tail first (so no tail write can race the sweep), then the
   * reconciling sweep, which waits for the harness's JSONL flush to catch up with what the tail
   * already imported before its delete-and-reimport.
   */
  private CommandExitListener chatTranscriptSweep() {
    return (commandId, exitCode, terminatedManually) -> {
      long importedLive = transcriptTailService.stopAndDrain(commandId);
      agentTranscriptService.onChatExit(commandId, importedLive);
    };
  }

  /**
   * Renders the stream-json chat launch for {@code scope} with its MCP servers attached and {@code
   * HOME} pointed at the shared credential volume. Package-visible so the credential overlay is
   * assertable without spawning a container.
   */
  LaunchSpec renderChat(
      String repoId, String workspaceId, AgentMcpScope scope, PinnedSession pinned) {
    CodingAgent agent = CodingAgentFactory.ofType(agentType);
    for (ScopedMcp server : serversFor(repoId, workspaceId, scope)) {
      agent.mcpServer(server.key(), McpServers.httpMcp(server.url()));
    }
    return withSession(withAgentHome(agent), pinned).skipPermissions().chat();
  }

  /**
   * Renders the one-shot autonomous run: the {@code scope} MCP servers attached (so {@code
   * taskPrompt} is reachable), the credential overlay, skip-permissions, and the bootstrap turn as
   * the {@code -p} argv. Package-visible so the MCP attachment is assertable without a container.
   */
  LaunchSpec renderAutonomous(
      String repoId, String workspaceId, AgentMcpScope scope, PinnedSession pinned) {
    CodingAgent agent = CodingAgentFactory.ofType(agentType);
    for (ScopedMcp server : serversFor(repoId, workspaceId, scope)) {
      // Unattended run under skip-permissions: mark the server read-only so
      // ReadOnlyRepositoryToolFilter (service module) hides the mutating repository tools
      // (createWorkspace/integrateBranch/…). The run still gets taskPrompt + the read-only tools;
      // its own git work happens inside its container, not via host-side MCP mutations.
      agent.mcpServer(server.key(), McpServers.httpMcp(readOnlyMarked(server.url())));
    }
    return withSession(withAgentHome(agent), pinned).skipPermissions().run(TASK_PROMPT_BOOTSTRAP);
  }

  /**
   * Appends the read-only marker query parameter to an MCP URL. The name must match {@code
   * ReadOnlyRepositoryToolFilter.READ_ONLY_PARAM} in the {@code service} module (the domain module
   * can't reference it).
   */
  private static String readOnlyMarked(String url) {
    return url + (url.contains("?") ? "&" : "?") + "agentReadOnly=true";
  }

  /**
   * Renders the interactive TUI launch: the same scope servers and overlays as chat, but the full
   * {@code claude} REPL ({@code start()}) with an optional seed prompt embedded. No {@code
   * flatOutput} — xterm.js renders the TUI; the readable conversation is the imported transcript.
   */
  LaunchSpec renderInteractive(
      String repoId,
      String workspaceId,
      AgentMcpScope scope,
      String initialContext,
      PinnedSession pinned) {
    CodingAgent agent = CodingAgentFactory.ofType(agentType);
    for (ScopedMcp server : serversFor(repoId, workspaceId, scope)) {
      agent.mcpServer(server.key(), McpServers.httpMcp(server.url()));
    }
    if (initialContext != null && !initialContext.isBlank()) {
      agent.initialContext(initialContext);
    }
    return withSession(withAgentHome(agent), pinned).skipPermissions().start();
  }

  /**
   * Points the agent's {@code HOME} at the shared credential volume so the in-container {@code
   * claude} reads the operator's one-time OAuth login. CWD stays {@code /workspace}, so project
   * detection (the repo's own {@code .claude/}, {@code CLAUDE.md}) is unaffected. Kimi Code uses
   * the container-level {@code KIMI_CODE_HOME} and its own per-launch symlink farm, so no {@code
   * HOME} overlay is needed.
   */
  private CodingAgent withAgentHome(CodingAgent agent) {
    if (agentType == AgentType.CLAUDE && claudeMount != null && !claudeMount.isBlank()) {
      agent.environment("HOME", claudeMount);
    }
    return agent;
  }

  /**
   * A scoped MCP server: the key it is registered under, its scoped URL, and its read-only tools.
   */
  public record ScopedMcp(String key, String url, List<String> allowedTools) {}

  /**
   * The scoped MCP servers for {@code scope}, with their read-only allowlists. Package-visible for
   * tests.
   */
  List<ScopedMcp> serversFor(String repoId, String workspaceId, AgentMcpScope scope) {
    String repo = requireUuid(repoId, "repository id");
    String projectId = projectIdFor(repo);
    // Project-scoped, then narrowed to this one repository so a per-subtree session only sees its
    // own repo, not its siblings in the project. The workspace narrowing is the third dimension:
    // it unlocks (and fences) the telemetry tools, which answer only for the session's workspace.
    ScopedMcp narrowedRepositoryServer =
        new ScopedMcp(
            "repository",
            repositoryMcpUrl()
                + "?projectId="
                + projectId
                + "&repositoryId="
                + repo
                + "&workspaceId="
                + workspaceId,
            READ_ONLY_REPOSITORY_TOOLS);
    return switch (scope) {
      case ACTIONS ->
          // The "configure this repository" session: the actions server for the action library,
          // plus the (narrowed) repository server — repository-owned configuration such as daemons
          // is managed there, and the session needs both to configure the repository fully.
          List.of(
              new ScopedMcp(
                  "actions", actionsMcpUrl() + "?repositoryId=" + repo, READ_ONLY_ACTION_TOOLS),
              narrowedRepositoryServer);
      case REPOSITORY -> List.of(narrowedRepositoryServer);
      case PROJECT ->
          // Project scope only, no repository narrowing — the session sees every repository in the
          // project. It still runs in some repository's workspace (the terminal needs a checkout).
          List.of(
              new ScopedMcp(
                  "repository",
                  repositoryMcpUrl() + "?projectId=" + projectId,
                  READ_ONLY_REPOSITORY_TOOLS));
    };
  }

  /**
   * The {@code actions} MCP base URL: the explicit override if set, else derived from the
   * container-reachable qits host + port (composed exactly like {@code WorkspaceService}'s git URL
   * and {@code OtelEnvironment}'s OTLP endpoint).
   */
  private String actionsMcpUrl() {
    return actionsMcpUrlOverride.orElseGet(() -> derivedMcpUrl("actions"));
  }

  /**
   * The {@code repository} MCP base URL: override if set, else derived like {@link #actionsMcpUrl}.
   */
  private String repositoryMcpUrl() {
    return repositoryMcpUrlOverride.orElseGet(() -> derivedMcpUrl("repository"));
  }

  private String derivedMcpUrl(String server) {
    return "http://" + qitsHostResolver.qitsHost() + ":" + qitsPort + "/mcp/" + server;
  }

  private String nameFor(AgentMcpScope scope) {
    return harnessName(
        scope,
        switch (agentType) {
          case CLAUDE -> "Claude Code";
          case KIMI -> "Kimi Code";
        });
  }

  private String interactiveNameFor(AgentMcpScope scope) {
    return harnessName(
        scope,
        switch (agentType) {
          case CLAUDE -> "Claude Code terminal";
          case KIMI -> "Kimi Code terminal";
        });
  }

  private static String harnessName(AgentMcpScope scope, String harnessLabel) {
    return switch (scope) {
      case ACTIONS -> harnessLabel + " (actions + repository MCP)";
      case REPOSITORY -> harnessLabel + " (repository MCP)";
      case PROJECT -> harnessLabel + " (project MCP)";
    };
  }

  /** The validated project id of {@code repositoryId}, read in its own transaction. */
  private String projectIdFor(String repositoryId) {
    String projectId =
        QuarkusTransaction.requiringNew()
            .call(
                () -> {
                  Repository repository =
                      repositoryRepository
                          .findByIdOptional(repositoryId)
                          .orElseThrow(
                              () -> new NotFoundException("Repository not found: " + repositoryId));
                  return repository.project.id;
                });
    return requireUuid(projectId, "project id");
  }

  private String requireUuid(String value, String label) {
    if (value == null || !UUID_PATTERN.matcher(value).matches()) {
      throw new BadRequestException("Invalid " + label + ": " + value);
    }
    return value;
  }
}
