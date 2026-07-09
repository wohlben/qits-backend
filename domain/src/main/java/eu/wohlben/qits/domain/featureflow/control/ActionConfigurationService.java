package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CRUD for actions of both scopes, kept strictly apart: the plain methods manage the
 * <strong>global</strong> library (and refuse repository-scoped ids), the {@code *ForRepository}
 * methods manage one repository's own actions (and refuse actions of another repository, so a
 * session scoped to one repository can never reach another's). The merged runnable set is resolved
 * by {@link ActionResolutionService}.
 */
@ApplicationScoped
public class ActionConfigurationService {

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Transactional
  public ActionConfiguration create(
      String name,
      String description,
      String executeScript,
      String checkScript,
      boolean interactive,
      Map<String, String> environment) {
    return createAction(
        null, name, description, executeScript, checkScript, interactive, environment);
  }

  @Transactional
  public ActionConfiguration createForRepository(
      String repositoryId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      boolean interactive,
      Map<String, String> environment) {
    Repository repository =
        repositoryRepository
            .findByIdOptional(repositoryId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
    return createAction(
        repository, name, description, executeScript, checkScript, interactive, environment);
  }

  private ActionConfiguration createAction(
      Repository repository,
      String name,
      String description,
      String executeScript,
      String checkScript,
      boolean interactive,
      Map<String, String> environment) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (executeScript == null || executeScript.isBlank()) {
      throw new BadRequestException("executeScript is required");
    }

    ActionConfiguration config = new ActionConfiguration();
    config.repository = repository;
    config.name = name;
    config.description = description;
    config.executeScript = executeScript;
    config.checkScript = checkScript;
    config.interactive = interactive;
    config.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    actionConfigurationRepository.persist(config);

    return config;
  }

  /** Loads a <strong>global</strong> action; repository-scoped ids are not found here. */
  public ActionConfiguration get(String id) {
    ActionConfiguration config =
        actionConfigurationRepository
            .findByIdOptional(id)
            .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + id));
    if (config.repository != null) {
      throw new NotFoundException("ActionConfiguration not found: " + id);
    }
    return config;
  }

  /** Loads a repository-scoped action and verifies it belongs to {@code repositoryId}. */
  public ActionConfiguration getForRepository(String repositoryId, String actionId) {
    ActionConfiguration action =
        actionConfigurationRepository
            .findByIdOptional(actionId)
            .orElseThrow(() -> new NotFoundException("Action not found: " + actionId));
    if (action.repository == null || !action.repository.id.equals(repositoryId)) {
      throw new NotFoundException("Action not found in this repository: " + actionId);
    }
    return action;
  }

  /** The global action library. */
  public List<ActionConfiguration> list() {
    return actionConfigurationRepository.listGlobal();
  }

  /** The actions owned by {@code repositoryId} (globals excluded). */
  public List<ActionConfiguration> listForRepository(String repositoryId) {
    return actionConfigurationRepository.listByRepositoryId(repositoryId);
  }

  @Transactional
  public ActionConfiguration update(
      String id,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Boolean interactive,
      Map<String, String> environment) {
    return applyUpdate(
        get(id), name, description, executeScript, checkScript, interactive, environment);
  }

  @Transactional
  public ActionConfiguration updateForRepository(
      String repositoryId,
      String actionId,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Boolean interactive,
      Map<String, String> environment) {
    return applyUpdate(
        getForRepository(repositoryId, actionId),
        name,
        description,
        executeScript,
        checkScript,
        interactive,
        environment);
  }

  private ActionConfiguration applyUpdate(
      ActionConfiguration config,
      String name,
      String description,
      String executeScript,
      String checkScript,
      Boolean interactive,
      Map<String, String> environment) {
    if (name != null && !name.isBlank()) {
      config.name = name;
    }
    if (description != null) {
      config.description = description;
    }
    if (executeScript != null && !executeScript.isBlank()) {
      config.executeScript = executeScript;
    }
    // checkScript is optional: a present (non-null) value sets or clears it; omit to keep as-is.
    if (checkScript != null) {
      config.checkScript = checkScript.isBlank() ? null : checkScript;
    }
    if (interactive != null) {
      config.interactive = interactive;
    }
    if (environment != null) {
      config.environment = new HashMap<>(environment);
    }

    return config;
  }

  @Transactional
  public void delete(String id) {
    actionConfigurationRepository.delete(get(id));
  }

  @Transactional
  public void deleteForRepository(String repositoryId, String actionId) {
    actionConfigurationRepository.delete(getForRepository(repositoryId, actionId));
  }
}
