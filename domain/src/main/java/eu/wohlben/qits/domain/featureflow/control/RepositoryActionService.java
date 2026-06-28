package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.featureflow.entity.RepositoryAction;
import eu.wohlben.qits.domain.featureflow.persistence.RepositoryActionRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CRUD for repository-scoped actions — the actions owned by one repository (see {@link
 * RepositoryAction}). Every method takes the owning {@code repositoryId} and refuses to touch an
 * action that belongs to a different repository, so a session scoped to one repository can never
 * reach another's actions. Global actions are managed separately by {@link
 * ActionConfigurationService}.
 */
@ApplicationScoped
public class RepositoryActionService {

  @Inject RepositoryActionRepository repositoryActionRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Transactional
  public RepositoryAction create(
      String repositoryId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      boolean interactive,
      ActionVariant variant,
      Map<String, String> environment) {
    Repository repository =
        repositoryRepository
            .findByIdOptional(repositoryId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (executeScript == null || executeScript.isBlank()) {
      throw new BadRequestException("executeScript is required");
    }

    RepositoryAction action = new RepositoryAction();
    action.repository = repository;
    action.name = name;
    action.description = description;
    action.executeScript = executeScript;
    action.checkScript = checkScript;
    action.interactive = interactive;
    action.variant = variant != null ? variant : ActionVariant.SHELL;
    action.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    repositoryActionRepository.persist(action);
    return action;
  }

  /** Loads an action and verifies it belongs to {@code repositoryId}. */
  public RepositoryAction get(String repositoryId, String actionId) {
    RepositoryAction action =
        repositoryActionRepository
            .findByIdOptional(actionId)
            .orElseThrow(() -> new NotFoundException("Action not found: " + actionId));
    if (!action.repository.id.equals(repositoryId)) {
      throw new NotFoundException("Action not found in this repository: " + actionId);
    }
    return action;
  }

  public List<RepositoryAction> list(String repositoryId) {
    return repositoryActionRepository.findByRepositoryId(repositoryId);
  }

  @Transactional
  public RepositoryAction update(
      String repositoryId,
      String actionId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Boolean interactive,
      ActionVariant variant,
      Map<String, String> environment) {
    RepositoryAction action = get(repositoryId, actionId);
    if (name != null && !name.isBlank()) {
      action.name = name;
    }
    if (description != null) {
      action.description = description;
    }
    if (executeScript != null && !executeScript.isBlank()) {
      action.executeScript = executeScript;
    }
    if (checkScript != null) {
      action.checkScript = checkScript.isBlank() ? null : checkScript;
    }
    if (interactive != null) {
      action.interactive = interactive;
    }
    if (variant != null) {
      action.variant = variant;
    }
    if (environment != null) {
      action.environment = new HashMap<>(environment);
    }
    return action;
  }

  @Transactional
  public void delete(String repositoryId, String actionId) {
    repositoryActionRepository.delete(get(repositoryId, actionId));
  }
}
