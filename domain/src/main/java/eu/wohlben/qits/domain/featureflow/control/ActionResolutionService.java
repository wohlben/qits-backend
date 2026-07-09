package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.featureflow.mapper.ActionConfigurationMapper;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Map;

/**
 * Resolves the actions <em>available in a repository</em>: the merge of the global library and that
 * repository's own actions (one query now that both scopes share a table). This is the single place
 * that defines that merge, so the Run… picker, the {@code runAction} runner and the MCP listing all
 * agree on what a repository can run.
 *
 * <p>Actions are plain shell scripts — their {@code executeScript} runs verbatim. Launching a
 * coding agent (e.g. Claude Code with an MCP server attached) is no longer modelled as an action
 * variant; it is a separate concern owned by {@code eu.wohlben.qits.domain.agent}.
 */
@ApplicationScoped
public class ActionResolutionService {

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject ActionConfigurationMapper actionConfigurationMapper;

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

  /**
   * Every action available in {@code repositoryId}: global ones plus the repository's own. Throws
   * {@link NotFoundException} if the repository does not exist.
   */
  @Transactional
  public List<ActionConfigurationDto> effectiveActions(String repositoryId) {
    repositoryRepository
        .findByIdOptional(repositoryId)
        .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
    return actionConfigurationRepository.listEffective(repositoryId).stream()
        .map(actionConfigurationMapper::toDto)
        .toList();
  }

  /**
   * Resolves {@code actionId} to run it in {@code repositoryId}. A global action resolves anywhere;
   * a repository action resolves only in its own repository. Throws {@link NotFoundException} if
   * the id is unknown or belongs to another repository — so a workspace can only ever run its
   * effective set.
   */
  @Transactional
  public ResolvedAction resolveForRepository(String repositoryId, String actionId) {
    ActionConfiguration action =
        actionConfigurationRepository
            .findByIdOptional(actionId)
            .orElseThrow(() -> new NotFoundException("Action not found: " + actionId));
    if (action.repository != null && !action.repository.id.equals(repositoryId)) {
      throw new NotFoundException("Action not available in this repository: " + actionId);
    }
    return new ResolvedAction(
        action.id,
        action.name,
        action.executeScript,
        action.interactive,
        action.repository == null ? ActionScope.GLOBAL : ActionScope.REPOSITORY,
        action.repository == null ? null : action.repository.id,
        action.environment);
  }
}
