package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;
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
          "mcp__repository__listActions");

  @Inject CommandService commandService;

  @Inject RepositoryRepository repositoryRepository;

  @ConfigProperty(name = "qits.actions-mcp.url", defaultValue = "http://localhost:8080/mcp/actions")
  String actionsMcpUrl;

  @ConfigProperty(
      name = "qits.repository-mcp.url",
      defaultValue = "http://localhost:8080/mcp/repository")
  String repositoryMcpUrl;

  /**
   * Launches Claude Code as a stream-json <strong>chat</strong> command in {@code worktreeId} of
   * {@code repoId}, with the MCP server for {@code scope} attached. The session is rendered as a
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

    ScopedMcp server = serverFor(repoId, scope);
    LaunchSpec spec =
        CodingAgentFactory.ofType(AgentType.CLAUDE)
            .mcpServer(server.key(), McpServers.httpMcp(server.url()))
            .skipPermissions()
            .chat();

    return commandService.launchChat(
        repoId, worktreeId, nameFor(scope), spec.script(), spec.environment());
  }

  /**
   * Spawns an autonomous, one-shot Claude run over {@code prompt} — no MCP server, permission
   * prompts skipped ({@code claude -p '…' --dangerously-skip-permissions}) — watched in a terminal.
   * Used by composed flows such as conflict resolution. Returns the spawned command.
   */
  public CommandDto launchAutonomous(String repoId, String worktreeId, String name, String prompt) {
    LaunchSpec spec = CodingAgentFactory.ofType(AgentType.CLAUDE).skipPermissions().run(prompt);
    return commandService.launchAgent(
        repoId, worktreeId, name, spec.script(), true, spec.environment());
  }

  /**
   * A scoped MCP server: the key it is registered under, its scoped URL, and its read-only tools.
   */
  public record ScopedMcp(String key, String url, List<String> allowedTools) {}

  /**
   * The scoped MCP server for {@code scope}, with its read-only allowlist. Package-visible for
   * tests.
   */
  ScopedMcp serverFor(String repoId, AgentMcpScope scope) {
    String repo = requireUuid(repoId, "repository id");
    return switch (scope) {
      case ACTIONS ->
          new ScopedMcp("actions", actionsMcpUrl + "?repositoryId=" + repo, READ_ONLY_ACTION_TOOLS);
      case REPOSITORY ->
          // Project-scoped, then narrowed to this one repository so a per-subtree session only sees
          // its own repo, not its siblings in the project.
          new ScopedMcp(
              "repository",
              repositoryMcpUrl + "?projectId=" + projectIdFor(repo) + "&repositoryId=" + repo,
              READ_ONLY_REPOSITORY_TOOLS);
      case PROJECT ->
          // Project scope only, no repository narrowing — the session sees every repository in the
          // project. It still runs in some repository's worktree (the terminal needs a checkout).
          new ScopedMcp(
              "repository",
              repositoryMcpUrl + "?projectId=" + projectIdFor(repo),
              READ_ONLY_REPOSITORY_TOOLS);
    };
  }

  private String nameFor(AgentMcpScope scope) {
    return switch (scope) {
      case ACTIONS -> "Claude Code (actions MCP)";
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
