package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
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

  /**
   * Declarative upsert used by {@code .qits-config.yml} ingestion: validates the required fields
   * and overwrites <strong>every</strong> field so the repository-scoped row exactly matches the
   * declaration (the file is the source of truth). Keeping the same {@code existingId} preserves
   * the action id, so feature-flow bindings and command history survive a re-ingest; {@code
   * existingId == null} inserts a fresh repository-scoped action.
   *
   * <p>Deliberately <strong>not</strong> {@code @Transactional}: it always runs inside a caller's
   * transaction, and if it threw as its own transactional boundary a caught validation failure
   * would still mark the reconciler's transaction rollback-only, discarding the valid entries and
   * warning.
   */
  public ActionConfiguration upsertFromConfig(
      String repositoryId,
      String existingId,
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
    ActionConfiguration config;
    if (existingId == null) {
      Repository repository =
          repositoryRepository
              .findByIdOptional(repositoryId)
              .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
      config = new ActionConfiguration();
      config.repository = repository;
    } else {
      config = getForRepository(repositoryId, existingId);
    }
    config.name = name;
    config.description = description;
    config.executeScript = executeScript;
    config.checkScript = checkScript != null && checkScript.isBlank() ? null : checkScript;
    config.interactive = interactive;
    config.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    if (existingId == null) {
      actionConfigurationRepository.persist(config);
    }
    return config;
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
    requireNotReservedName(name);
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
      requireNotReservedName(name);
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

  /**
   * Rejects a user-supplied name that lands in the {@code .qits-config.yml} namespace. That suffix
   * is reserved for config-declared actions (written only by {@link #upsertFromConfig}); letting a
   * user create one would make their hand-made action look config-managed and get deleted on the
   * next reconcile.
   */
  private static void requireNotReservedName(String name) {
    if (QitsConfig.isConfigName(name)) {
      throw new BadRequestException(
          "name may not use the reserved '"
              + QitsConfig.CONFIG_NAME_SUFFIX
              + "' suffix (it is managed by .qits-config.yml)");
    }
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
