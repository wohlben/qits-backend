package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.command.control.CommandRegistry;
import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.daemon.control.DaemonEventSpool;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.WorktreeService;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Launches a coding agent (Claude Code) into a worktree with an MCP server attached, scoped to the
 * repository or project it runs in. This is the separate "agent code path" that replaced the old
 * {@code CLAUDE_*} action variants: it renders the launch with {@link CodingAgentFactory}, writes
 * any seed prompt into the worktree, and spawns it as a registry {@link CommandDto} — so an agent
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

  /** Worktree ids are path segments, so they must be strict slugs (mirrors WorktreeService). */
  private static final Pattern WORKTREE_ID_PATTERN = Pattern.compile("[A-Za-z0-9_-]{1,64}");

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
          "mcp__repository__listWorktrees",
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

  @Inject WorktreeService worktreeService;

  @ConfigProperty(name = "qits.actions-mcp.url", defaultValue = "http://localhost:8080/mcp/actions")
  String actionsMcpUrl;

  @ConfigProperty(
      name = "qits.repository-mcp.url",
      defaultValue = "http://localhost:8080/mcp/repository")
  String repositoryMcpUrl;

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
   * Launches Claude Code as a stream-json <strong>chat</strong> command in {@code worktreeId} of
   * {@code repoId}, with the MCP server(s) for {@code scope} attached. The session is rendered as a
   * conversation and tracked in the command registry (re-attachable, logged). Tools run
   * auto-approved ({@code --dangerously-skip-permissions}): the CLI does not expose the stream-json
   * permission-prompt protocol, so in-UI approval isn't currently possible; a networked deployment
   * would want that. Returns the spawned command.
   */
  public CommandDto launchChat(
      String repoId, String worktreeId, AgentMcpScope scope, String initialContext) {
    if (scope == null) {
      throw new BadRequestException("scope is required");
    }
    if (!WORKTREE_ID_PATTERN.matcher(worktreeId == null ? "" : worktreeId).matches()) {
      throw new BadRequestException("Invalid worktree id: " + worktreeId);
    }
    // Guard the repo id (a UUID) before ensureContainer, so a bad id is a 400 here rather than a
    // 404 "worktree not found" from the lookup below.
    requireUuid(repoId, "repository id");

    // Re-provision a lost container up front so the sign-in probe below runs against a live
    // container (a stopped one would read as not-signed-in and wrongly redirect to login, even
    // though the credentials live on the shared volume). Also lets a missing branch fail loudly.
    worktreeService.ensureContainer(repoId, worktreeId);

    // The agent can't authenticate until an operator has signed in on the shared credential volume.
    // When it hasn't, launch an interactive `claude` REPL terminal instead — the caller redirects
    // to
    // its command page (a real PTY), the operator finishes OAuth through the REPL onboarding there,
    // and the next chat launch (this worktree or any other, same volume) sees the login and
    // proceeds.
    if (!agentAuthStatus.isLoggedIn(repoId, worktreeId)) {
      return launchLogin(repoId, worktreeId);
    }

    LaunchSpec spec = renderChat(repoId, worktreeId, scope);

    CommandDto command =
        commandService.launchChat(
            repoId, worktreeId, nameFor(scope), spec.script(), spec.environment());
    if (initialContext != null && !initialContext.isBlank()) {
      // Seed the conversation as the first user turn. A stream-json chat only speaks over stdin,
      // so the seed can't be a CLI argument; the pipe buffers it until claude starts reading.
      commandRegistry.chatSend(command.id(), initialContext);
    }
    // Daemon events that fired while no chat was running land in the new session right after the
    // seed prompt, so the agent starts with the worktree's recent daemon history.
    List<String> spooledEvents = daemonEventSpool.drain(repoId, worktreeId);
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
  public CommandDto launchAutonomous(String repoId, String worktreeId, String name, String prompt) {
    LaunchSpec spec = renderAutonomous(prompt);
    return commandService.launchAgent(
        repoId, worktreeId, name, spec.script(), true, spec.environment());
  }

  /**
   * Launches an interactive {@code claude} REPL terminal (a normal PTY command, kind {@code
   * TERMINAL}) in the worktree's container so an operator can complete the one-time OAuth through
   * its onboarding paste flow. Writes to the shared credential volume (HOME overlay), so it signs
   * in every worktree at once. Returned by {@link #launchChat} when the agent isn't signed in yet;
   * the caller redirects to its terminal.
   */
  public CommandDto launchLogin(String repoId, String worktreeId) {
    LaunchSpec spec = renderLogin();
    return commandService.launchAgent(
        repoId, worktreeId, "Claude sign-in", spec.script(), true, spec.environment());
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
   * Renders the stream-json chat launch for {@code scope} with its MCP servers attached and {@code
   * HOME} pointed at the shared credential volume. Package-visible so the credential overlay is
   * assertable without spawning a container.
   */
  LaunchSpec renderChat(String repoId, String worktreeId, AgentMcpScope scope) {
    CodingAgent agent = CodingAgentFactory.ofType(AgentType.CLAUDE);
    for (ScopedMcp server : serversFor(repoId, worktreeId, scope)) {
      agent.mcpServer(server.key(), McpServers.httpMcp(server.url()));
    }
    return withAgentHome(agent).skipPermissions().chat();
  }

  /** Renders the one-shot autonomous run over {@code prompt}, with the same credential overlay. */
  LaunchSpec renderAutonomous(String prompt) {
    return withAgentHome(CodingAgentFactory.ofType(AgentType.CLAUDE).skipPermissions()).run(prompt);
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
  List<ScopedMcp> serversFor(String repoId, String worktreeId, AgentMcpScope scope) {
    String repo = requireUuid(repoId, "repository id");
    String projectId = projectIdFor(repo);
    // Project-scoped, then narrowed to this one repository so a per-subtree session only sees its
    // own repo, not its siblings in the project. The worktree narrowing is the third dimension:
    // it unlocks (and fences) the telemetry tools, which answer only for the session's worktree.
    ScopedMcp narrowedRepositoryServer =
        new ScopedMcp(
            "repository",
            repositoryMcpUrl
                + "?projectId="
                + projectId
                + "&repositoryId="
                + repo
                + "&worktreeId="
                + worktreeId,
            READ_ONLY_REPOSITORY_TOOLS);
    return switch (scope) {
      case ACTIONS ->
          // The "configure this repository" session: the actions server for the action library,
          // plus the (narrowed) repository server — repository-owned configuration such as daemons
          // is managed there, and the session needs both to configure the repository fully.
          List.of(
              new ScopedMcp(
                  "actions", actionsMcpUrl + "?repositoryId=" + repo, READ_ONLY_ACTION_TOOLS),
              narrowedRepositoryServer);
      case REPOSITORY -> List.of(narrowedRepositoryServer);
      case PROJECT ->
          // Project scope only, no repository narrowing — the session sees every repository in the
          // project. It still runs in some repository's worktree (the terminal needs a checkout).
          List.of(
              new ScopedMcp(
                  "repository",
                  repositoryMcpUrl + "?projectId=" + projectId,
                  READ_ONLY_REPOSITORY_TOOLS));
    };
  }

  private String nameFor(AgentMcpScope scope) {
    return switch (scope) {
      case ACTIONS -> "Claude Code (actions + repository MCP)";
      case REPOSITORY -> "Claude Code (repository MCP)";
      case PROJECT -> "Claude Code (project MCP)";
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
