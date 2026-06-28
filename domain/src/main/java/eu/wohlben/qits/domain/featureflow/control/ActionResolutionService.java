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

  /** Repository ids are generated UUIDs; only hex and dashes ever appear. */
  private static final Pattern REPOSITORY_ID = Pattern.compile("[0-9a-fA-F-]{36}");

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject RepositoryActionRepository repositoryActionRepository;

  @Inject ActionConfigurationMapper actionConfigurationMapper;

  @Inject RepositoryActionMapper repositoryActionMapper;

  /** Base URL of the actions MCP server, used to render the CLAUDE_ACTIONS_MCP variant. */
  @ConfigProperty(name = "qits.actions-mcp.url", defaultValue = "http://localhost:8080/mcp/actions")
  String actionsMcpUrl;

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
   * verbatim; {@link ActionVariant#CLAUDE_ACTIONS_MCP} appends Claude Code's MCP flags pointing at
   * the actions server scoped to {@code repositoryId} (via the {@code ?repositoryId=} query param
   * that {@code RepositoryScope} accepts). The whole thing is built here, in backend code — the UI
   * never supplies these flags.
   */
  private String renderCommand(ActionVariant variant, String executeScript, String repositoryId) {
    if (variant != ActionVariant.CLAUDE_ACTIONS_MCP) {
      return executeScript;
    }
    // repositoryId is interpolated into a single-quoted shell argument below. It is always a
    // system-generated UUID, but validate strictly so a non-UUID can never carry a quote or shell
    // metacharacter that breaks out of the quoting (command injection).
    if (repositoryId == null || !REPOSITORY_ID.matcher(repositoryId).matches()) {
      throw new BadRequestException("Invalid repository id: " + repositoryId);
    }
    // Single-quoted JSON: no shell expansion, and the validated UUID repositoryId is safe to embed.
    String json =
        "{\"mcpServers\":{\"actions\":{\"type\":\"http\",\"url\":\""
            + actionsMcpUrl
            + "?repositoryId="
            + repositoryId
            + "\"}}}";
    return executeScript + " --strict-mcp-config --mcp-config '" + json + "'";
  }
}
