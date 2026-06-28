package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
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

/**
 * Resolves the actions <em>available in a repository</em>: the merge of the global library and that
 * repository's own actions. This is the single place that joins the two scopes, so the Run… picker,
 * the {@code runAction} runner and the MCP listing all agree on what a repository can run.
 */
@ApplicationScoped
public class ActionResolutionService {

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject RepositoryActionRepository repositoryActionRepository;

  @Inject ActionConfigurationMapper actionConfigurationMapper;

  @Inject RepositoryActionMapper repositoryActionMapper;

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
          global.executeScript,
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
          repoAction.executeScript,
          repoAction.interactive,
          ActionScope.REPOSITORY,
          repoAction.repository.id,
          repoAction.environment);
    }

    throw new NotFoundException("Action not found: " + actionId);
  }
}
