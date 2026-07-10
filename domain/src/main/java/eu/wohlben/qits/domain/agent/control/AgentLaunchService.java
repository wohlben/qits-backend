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

/**
 * Launches a coding agent (Claude Code) into a workspace with an MCP server attached, scoped to the
 * repository or project it runs in. This is the separate "agent code path" that replaced the old
 * {@code CLAUDE_*} action variants: it renders the launch with {@link CodingAgentFactory}, writes
 * any seed prompt into the workspace, and spawns it as a registry {@link CommandDto} — so an agent
 * session still shows up in the Commands list and is attachable/terminable like any other command.
 *
 * <p>Owns the MCP scope→URL construction (the read-only allowlists and the {@code ?repositoryId=} /
 * {@code ?projectId=} query params) that used to live in {@code ActionResolutionService}. Scope ids
 * are validated as UUIDs before being interpolated into the (single-quoted) launch args, since the
 * agent renderer does no escaping of its own.
 */
@ApplicationScoped
public class AgentLaunchService {

  /** Repository and project ids are generated UUIDs; only hex and dashes ever appear. */
  private static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F-]{36}");

  /** Workspace ids are path segments, so they must be strict slugs (mirrors WorkspaceService). */
  private static final Pattern WORKSPACE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

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

  /**
   * Launches Claude Code as a stream-json <strong>chat</strong> command in {@code workspaceId} of
   * {@code repoId}, with the MCP server(s) for {@code scope} attached. The session is rendered as a
   * conversation and tracked in the command registry (re-attachable, logged). Tools run
   * auto-approved ({@code --dangerously-skip-permissions}): the CLI does not expose the stream-json
   * permission-prompt protocol, so in-UI approval isn't currently possible; a networked deployment
   * would want that. Returns the spawned command.
   */
  public CommandDto launchChat(
      String repoId, String workspaceId, AgentMcpScope scope, String initialContext) {
    return launchChat(repoId, workspaceId, scope, initialContext, null, false);
  }

  /**
   * {@link #launchChat} with session lineage: a non-null {@code resumeSessionId} continues that
   * session (it must belong to this workspace); {@code fork} additionally branches it into a fresh
   * qits-pinned id. With neither, a fresh session id is pinned. Every launch records its first
   * {@link AgentSessionRef} on the command row and carries the session-report hook.
   */
  public CommandDto launchChat(
      String repoId,
      String workspaceId,
      AgentMcpScope scope,
      String initialContext,
      String resumeSessionId,
      boolean fork) {
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
    // When it hasn't, launch an interactive `claude` REPL terminal instead — the caller redirects
    // to
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
    if (initialContext != null && !initialContext.isBlank()) {
      // Seed the conversation as the first user turn. A stream-json chat only speaks over stdin,
      // so the seed can't be a CLI argument; the pipe buffers it until claude starts reading.
      commandRegistry.chatSend(command.id(), initialContext);
    }
    // Daemon events that fired while no chat was running land in the new session right after the
    // seed prompt, so the agent starts with the workspace's recent daemon history.
    List<String> spooledEvents = daemonEventSpool.drain(repoId, workspaceId);
    if (!spooledEvents.isEmpty()) {
      commandRegistry.chatSend(command.id(), String.join("\n\n", spooledEvents));
    }
    return command;
  }

  /**
   * Spawns an autonomous, one-shot Claude run over {@code prompt} — no MCP server, permission
   * prompts skipped ({@code claude -p '…' --dangerously-skip-permissions}) — watched in a terminal.
   * Used by composed flows such as conflict resolution. Returns the spawned command.
   */
  public CommandDto launchAutonomous(
      String repoId, String workspaceId, String name, String prompt) {
    PinnedSession pinned = pinSession(repoId, workspaceId, null, false);
    LaunchSpec spec = renderAutonomous(prompt, pinned);
    return commandService.launchAgent(
        repoId,
        workspaceId,
        name,
        spec.script(),
        true,
        spec.environment(),
        pinned.commandId(),
        pinned.ref(),
        transcriptSweep());
  }

  /**
   * Launches the full interactive Claude Code TUI (the plain {@code claude} REPL in xterm.js, kind
   * {@code TERMINAL}) as a first-class agent session: same MCP scope servers, credential overlay
   * and skip-permissions as chat, plus a pinned session id and the session-report hook — so the run
   * is resumable, forkable, and its transcript is imported on exit like any chat. The PTY byte
   * stream stays terminal-only; the structured conversation comes from the transcript.
   */
  public CommandDto launchInteractive(
      String repoId,
      String workspaceId,
      AgentMcpScope scope,
      String initialContext,
      String resumeSessionId,
      boolean fork) {
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

    PinnedSession pinned = pinSession(repoId, workspaceId, resumeSessionId, fork);
    LaunchSpec spec = renderInteractive(repoId, workspaceId, scope, initialContext, pinned);
    return commandService.launchAgent(
        repoId,
        workspaceId,
        interactiveNameFor(scope),
        spec.script(),
        true,
        spec.environment(),
        pinned.commandId(),
        pinned.ref(),
        transcriptSweep());
  }

  /**
   * Launches an interactive {@code claude} REPL terminal (a normal PTY command, kind {@code
   * TERMINAL}) in the workspace's container so an operator can complete the one-time OAuth through
   * its onboarding paste flow. Writes to the shared credential volume (HOME overlay), so it signs
   * in every workspace at once. Returned by {@link #launchChat} when the agent isn't signed in yet;
   * the caller redirects to its terminal.
   */
  public CommandDto launchLogin(String repoId, String workspaceId) {
    LaunchSpec spec = renderLogin();
    return commandService.launchAgent(
        repoId, workspaceId, "Claude sign-in", spec.script(), true, spec.environment());
  }

  /** Renders the interactive login command with the shared-volume {@code HOME} overlay. */
  LaunchSpec renderLogin() {
    Map<String, String> env = new HashMap<>();
    if (claudeMount != null && !claudeMount.isBlank()) {
      env.put("HOME", claudeMount);
    }
    // Run the `claude` REPL, NOT the `claude auth login` subcommand. The REPL's first-run
    // onboarding
    // (theme -> login method -> OAuth) renders a paste-the-code prompt over the PTY and reads it
    // from
    // stdin, so an operator can complete sign-in in the terminal. The `auth login` subcommand does
    // not: in Claude Code v2.1.89 it prints the authorize URL and then blocks on a loopback HTTP
    // callback the host browser can never reach — no paste prompt, no stdin read — so its terminal
    // looks dead. See docs/issues/resolved/2026-07-05_claude-auth-login-terminal-no-input.md.
    return new LaunchSpec("exec claude", true, env);
  }

  /**
   * A launch's session identity, generated before anything exists: the command id (rendered into
   * the session-report hook URL) and the first {@link AgentSessionRef} of its session list.
   */
  record PinnedSession(String commandId, AgentSessionRef ref) {}

  /**
   * Pins the launch's session identity. Fresh launches pin a brand-new UUID ({@code PINNED});
   * resume reuses {@code resumeSessionId} in place ({@code RESUMED}); fork branches it into a fresh
   * pin ({@code FORKED}, with the origin recorded). Resume/fork require the session to belong to
   * this workspace — iteration one keeps lineage where the transcript's file references and git
   * state live. A retried launch pins fresh ids (pinned ids are create-only).
   */
  PinnedSession pinSession(
      String repoId, String workspaceId, String resumeSessionId, boolean fork) {
    String commandId = UUID.randomUUID().toString();
    if (resumeSessionId == null) {
      if (fork) {
        throw new BadRequestException("fork requires resumeSessionId");
      }
      return new PinnedSession(
          commandId,
          new AgentSessionRef(
              UUID.randomUUID().toString(), AgentSessionSource.PINNED, null, null, Instant.now()));
    }
    requireUuid(resumeSessionId, "session id");
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

  /** Configures the agent's session flags + report hook from the pinned identity. */
  private CodingAgent withSession(CodingAgent agent, PinnedSession pinned) {
    AgentSessionRef ref = pinned.ref();
    switch (ref.source) {
      case PINNED -> agent.sessionId(ref.sessionId);
      case RESUMED -> agent.resume(ref.sessionId);
      case FORKED -> agent.resume(ref.forkedFromSessionId).fork(ref.sessionId);
      case SWITCHED ->
          throw new IllegalStateException("SWITCHED is hook-reported, never a launch source");
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
    CodingAgent agent = CodingAgentFactory.ofType(AgentType.CLAUDE);
    for (ScopedMcp server : serversFor(repoId, workspaceId, scope)) {
      agent.mcpServer(server.key(), McpServers.httpMcp(server.url()));
    }
    return withSession(withAgentHome(agent), pinned).skipPermissions().chat();
  }

  /** Renders the one-shot autonomous run over {@code prompt}, with the same credential overlay. */
  LaunchSpec renderAutonomous(String prompt, PinnedSession pinned) {
    return withSession(
            withAgentHome(CodingAgentFactory.ofType(AgentType.CLAUDE).skipPermissions()), pinned)
        .run(prompt);
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
    CodingAgent agent = CodingAgentFactory.ofType(AgentType.CLAUDE);
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
   * detection (the repo's own {@code .claude/}, {@code CLAUDE.md}) is unaffected.
   */
  private CodingAgent withAgentHome(CodingAgent agent) {
    if (claudeMount != null && !claudeMount.isBlank()) {
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
    return switch (scope) {
      case ACTIONS -> "Claude Code (actions + repository MCP)";
      case REPOSITORY -> "Claude Code (repository MCP)";
      case PROJECT -> "Claude Code (project MCP)";
    };
  }

  private String interactiveNameFor(AgentMcpScope scope) {
    return switch (scope) {
      case ACTIONS -> "Claude Code terminal (actions + repository MCP)";
      case REPOSITORY -> "Claude Code terminal (repository MCP)";
      case PROJECT -> "Claude Code terminal (project MCP)";
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
