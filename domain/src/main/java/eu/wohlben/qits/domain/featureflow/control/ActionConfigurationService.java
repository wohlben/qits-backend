package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CRUD for the <strong>global</strong> (code-based) action library — the only actions that exist as
 * rows since Part 5 (config-as-single-source-of-truth) removed the repo-scoped DB config store.
 * Config-declared actions live only in the workspace's committed {@code .qits-config.yml}.
 */
@ApplicationScoped
public class ActionConfigurationService {

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Transactional
  public ActionConfiguration create(
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
    config.name = name;
    config.description = description;
    config.executeScript = executeScript;
    config.checkScript = checkScript;
    config.interactive = interactive;
    config.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    actionConfigurationRepository.persist(config);

    return config;
  }

  /** Loads a global action by id. */
  public ActionConfiguration get(String id) {
    return actionConfigurationRepository
        .findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("ActionConfiguration not found: " + id));
  }

  /** The global action library. */
  public List<ActionConfiguration> list() {
    return actionConfigurationRepository.listGlobal();
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
    ActionConfiguration config = get(id);
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
}
