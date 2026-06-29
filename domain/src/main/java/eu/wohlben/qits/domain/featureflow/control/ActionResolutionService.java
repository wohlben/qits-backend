package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.featureflow.entity.RepositoryAction;
import eu.wohlben.qits.domain.featureflow.mapper.ActionConfigurationMapper;
import eu.wohlben.qits.domain.featureflow.mapper.RepositoryActionMapper;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.featureflow.persistence.RepositoryActionRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Resolves the actions <em>available in a repository</em>: the merge of the global library and that
 * repository's own actions. This is the single place that joins the two scopes, so the Run… picker,
 * the {@code runAction} runner and the MCP listing all agree on what a repository can run.
 */
@ApplicationScoped
public class ActionResolutionService {

  /** Repository and project ids are generated UUIDs; only hex and dashes ever appear. */
  private static final Pattern UUID_PATTERN = Pattern.compile("[0-9a-fA-F-]{36}");

  /**
   * The read-only tools of the {@code actions} MCP server, pre-approved for the Claude launch so
   * the session can list/inspect actions without a permission prompt. The mutating tools ({@code
   * create*}/{@code update*}/{@code delete*}) are deliberately left out so Claude still prompts
   * before changing anything. Names are Claude's MCP tool ids: {@code mcp__<server>__<tool>} where
   * the server is {@code actions} (the key in the rendered {@code --mcp-config} JSON below).
   */
  private static final List<String> READ_ONLY_ACTION_TOOLS =
      List.of(
          "mcp__actions__listGlobalActions",
          "mcp__actions__getGlobalAction",
          "mcp__actions__listRepositoryActions",
          "mcp__actions__getRepositoryAction");

  /**
   * The read-only tools of the {@code repository} MCP server, pre-approved the same way. The
   * mutating tools ({@code createWorktree}, {@code cleanupBranch}, {@code integrateBranch}, {@code
   * mergeParentIntoWorktree}, {@code runAction}) are left out so Claude prompts before changing the
   * repository.
   */
  private static final List<String> READ_ONLY_REPOSITORY_TOOLS =
      List.of(
          "mcp__repository__listRepositories",
          "mcp__repository__listBranches",
          "mcp__repository__listWorktrees",
          "mcp__repository__listCommits",
          "mcp__repository__listCommitChanges",
          "mcp__repository__getCommitFileDiff",
          "mcp__repository__listActions");

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject RepositoryActionRepository repositoryActionRepository;

  @Inject ActionConfigurationMapper actionConfigurationMapper;

  @Inject RepositoryActionMapper repositoryActionMapper;

  @Inject RepositoryRepository repositoryRepository;

  /** Base URL of the actions MCP server, used to render the CLAUDE_ACTIONS_MCP variant. */
  @ConfigProperty(name = "qits.actions-mcp.url", defaultValue = "http://localhost:8080/mcp/actions")
  String actionsMcpUrl;

  /** Base URL of the repository MCP server, used to render the CLAUDE_REPOSITORY_MCP variant. */
  @ConfigProperty(
      name = "qits.repository-mcp.url",
      defaultValue = "http://localhost:8080/mcp/repository")
  String repositoryMcpUrl;

  /**
   * A resolved action flattened to just what running it needs, regardless of which scope it came
   * from.
   */
  public record ResolvedAction(
      String id,
      String name,
      String executeScript,
      boolean interactive,
      ActionScope scope,
      String repositoryId,
      Map<String, String> environment) {}

  /** Every action available in {@code repositoryId}: global ones plus the repository's own. */
  @Transactional
  public List<ActionConfigurationDto> effectiveActions(String repositoryId) {
    List<ActionConfigurationDto> actions = new ArrayList<>();
    actionConfigurationRepository.listAll().stream()
        .map(actionConfigurationMapper::toDto)
        .forEach(actions::add);
    repositoryActionRepository.findByRepositoryId(repositoryId).stream()
        .map(repositoryActionMapper::toDto)
        .forEach(actions::add);
    return actions;
  }

  /**
   * Resolves {@code actionId} to run it in {@code repositoryId}. A global action resolves anywhere;
   * a repository action resolves only in its own repository. Throws {@link NotFoundException} if
   * the id is unknown or belongs to another repository — so a worktree can only ever run its
   * effective set.
   */
  @Transactional
  public ResolvedAction resolveForRepository(String repositoryId, String actionId) {
    ActionConfiguration global =
        actionConfigurationRepository.findByIdOptional(actionId).orElse(null);
    if (global != null) {
      return new ResolvedAction(
          global.id,
          global.name,
          renderCommand(global.variant, global.executeScript, repositoryId),
          global.interactive,
          ActionScope.GLOBAL,
          null,
          global.environment);
    }

    RepositoryAction repoAction =
        repositoryActionRepository.findByIdOptional(actionId).orElse(null);
    if (repoAction != null) {
      if (!repoAction.repository.id.equals(repositoryId)) {
        throw new NotFoundException("Action not available in this repository: " + actionId);
      }
      return new ResolvedAction(
          repoAction.id,
          repoAction.name,
          renderCommand(repoAction.variant, repoAction.executeScript, repositoryId),
          repoAction.interactive,
          ActionScope.REPOSITORY,
          repoAction.repository.id,
          repoAction.environment);
    }

    throw new NotFoundException("Action not found: " + actionId);
  }

  /**
   * Renders the shell command for an action's variant. {@link ActionVariant#SHELL} runs the script
   * verbatim. {@link ActionVariant#CLAUDE_ACTIONS_MCP} appends Claude Code's MCP flags pointing at
   * the actions server scoped to {@code repositoryId} (via the {@code ?repositoryId=} query param
   * that {@code RepositoryScope} accepts). {@link ActionVariant#CLAUDE_REPOSITORY_MCP} points at
   * the repository server, which is <em>project</em>-scoped, so it resolves the repository's
   * project id and passes {@code ?projectId=}. Both add an {@code --allowedTools} list that
   * pre-approves the read-only tools while leaving the mutating ones to prompt. The whole thing is
   * built here, in backend code — the UI never supplies these flags.
   */
  private String renderCommand(ActionVariant variant, String executeScript, String repositoryId) {
    return switch (variant) {
      case SHELL -> executeScript;
      case CLAUDE_ACTIONS_MCP ->
          claudeLaunch(
              executeScript,
              "actions",
              actionsMcpUrl + "?repositoryId=" + requireUuid(repositoryId, "repository id"),
              READ_ONLY_ACTION_TOOLS);
      case CLAUDE_REPOSITORY_MCP -> {
        // Project-scoped, then narrowed to this one repository (the optional repository scope) so a
        // per-subtree session only sees its own repo, not its siblings in the project.
        String repoId = requireUuid(repositoryId, "repository id");
        yield claudeLaunch(
            executeScript,
            "repository",
            repositoryMcpUrl + "?projectId=" + projectIdFor(repoId) + "&repositoryId=" + repoId,
            READ_ONLY_REPOSITORY_TOOLS);
      }
      case CLAUDE_PROJECT_MCP ->
          // Project scope only, no repository narrowing — the session sees every repository in the
          // project. It still runs in some repository's worktree (the terminal needs a checkout),
          // but the MCP scope spans the whole project.
          claudeLaunch(
              executeScript,
              "repository",
              repositoryMcpUrl + "?projectId=" + projectIdFor(repositoryId),
              READ_ONLY_REPOSITORY_TOOLS);
    };
  }

  /**
   * The project id of {@code repositoryId}, for scoping the project-scoped repository MCP server.
   */
  private String projectIdFor(String repositoryId) {
    Repository repository =
        repositoryRepository
            .findByIdOptional(requireUuid(repositoryId, "repository id"))
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
    return requireUuid(repository.project.id, "project id");
  }

  /**
   * Builds a Claude Code launch with a single HTTP MCP server attached and a read-only allowlist.
   * The {@code scopedUrl} is interpolated into a single-quoted shell argument, so its only variable
   * part — the id in the query string — must already be a validated UUID (see {@link
   * #requireUuid}). The {@code allowedTools} are a fixed code constant, comma-joined into one arg.
   */
  private String claudeLaunch(
      String executeScript, String serverKey, String scopedUrl, List<String> allowedTools) {
    // Single-quoted JSON: no shell expansion, and the scoped URL only carries validated UUIDs.
    String json =
        "{\"mcpServers\":{\""
            + serverKey
            + "\":{\"type\":\"http\",\"url\":\""
            + scopedUrl
            + "\"}}}";
    return executeScript
        + " --strict-mcp-config --mcp-config '"
        + json
        + "' --allowedTools '"
        + String.join(",", allowedTools)
        + "'";
  }

  /**
   * Returns {@code value} if it is a system-generated UUID, else throws. Ids are interpolated into
   * single-quoted shell arguments, so a non-UUID could otherwise carry a quote or shell
   * metacharacter that breaks out of the quoting (command injection).
   */
  private String requireUuid(String value, String label) {
    if (value == null || !UUID_PATTERN.matcher(value).matches()) {
      throw new BadRequestException("Invalid " + label + ": " + value);
    }
    return value;
  }
}
