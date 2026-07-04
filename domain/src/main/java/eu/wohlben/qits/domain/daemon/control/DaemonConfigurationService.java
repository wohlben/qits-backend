package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonConfiguration;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.persistence.DaemonConfigurationRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** CRUD over the global daemon library — the daemon sibling of ActionConfigurationService. */
@ApplicationScoped
public class DaemonConfigurationService {

  @Inject DaemonConfigurationRepository daemonConfigurationRepository;

  @Transactional
  public DaemonConfiguration create(
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Integer maxRestarts,
      Map<String, String> environment,
      List<LogObserver> observers) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (startScript == null || startScript.isBlank()) {
      throw new BadRequestException("startScript is required");
    }
    DaemonDefinitionValidator.requireValidRegex(readyPattern, "readyPattern");
    DaemonDefinitionValidator.requireValidObservers(observers);

    DaemonConfiguration config = new DaemonConfiguration();
    config.name = name;
    config.description = description;
    config.startScript = startScript;
    config.readyPattern = blankToNull(readyPattern);
    config.stopSignal = DaemonDefinitionValidator.normalizeStopSignal(stopSignal);
    config.restartPolicy = restartPolicy != null ? restartPolicy : RestartPolicy.ON_FAILURE;
    config.maxRestarts = maxRestarts != null ? maxRestarts : 3;
    config.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    config.observers = observers != null ? new ArrayList<>(observers) : new ArrayList<>();
    daemonConfigurationRepository.persist(config);

    return config;
  }

  public DaemonConfiguration get(String id) {
    return daemonConfigurationRepository
        .findByIdOptional(id)
        .orElseThrow(() -> new NotFoundException("DaemonConfiguration not found: " + id));
  }

  public List<DaemonConfiguration> list() {
    return daemonConfigurationRepository.listAll();
  }

  @Transactional
  public DaemonConfiguration update(
      String id,
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Integer maxRestarts,
      Map<String, String> environment,
      List<LogObserver> observers) {
    DaemonConfiguration config = get(id);

    if (name != null && !name.isBlank()) {
      config.name = name;
    }
    if (description != null) {
      config.description = description;
    }
    if (startScript != null && !startScript.isBlank()) {
      config.startScript = startScript;
    }
    // readyPattern is optional: a present (non-null) value sets or clears it; omit to keep as-is.
    if (readyPattern != null) {
      DaemonDefinitionValidator.requireValidRegex(readyPattern, "readyPattern");
      config.readyPattern = blankToNull(readyPattern);
    }
    if (stopSignal != null) {
      config.stopSignal = DaemonDefinitionValidator.normalizeStopSignal(stopSignal);
    }
    if (restartPolicy != null) {
      config.restartPolicy = restartPolicy;
    }
    if (maxRestarts != null) {
      config.maxRestarts = maxRestarts;
    }
    if (environment != null) {
      config.environment = new HashMap<>(environment);
    }
    if (observers != null) {
      DaemonDefinitionValidator.requireValidObservers(observers);
      config.observers = new ArrayList<>(observers);
    }

    return config;
  }

  @Transactional
  public void delete(String id) {
    daemonConfigurationRepository.delete(get(id));
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }
}
