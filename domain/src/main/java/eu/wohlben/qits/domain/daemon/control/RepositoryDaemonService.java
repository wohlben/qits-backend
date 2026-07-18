package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.entity.WebView;
import eu.wohlben.qits.domain.daemon.mapper.RepositoryDaemonMapper;
import eu.wohlben.qits.domain.daemon.persistence.RepositoryDaemonRepository;
import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CRUD over one repository's daemons — the only scope daemons have; every access enforces
 * ownership. Also the supervisor's resolution point ({@link #resolve}/{@link #resolveAll}).
 */
@ApplicationScoped
public class RepositoryDaemonService {

  @Inject RepositoryDaemonRepository repositoryDaemonRepository;

  @Inject RepositoryRepository repositoryRepository;

  @Inject RepositoryDaemonMapper repositoryDaemonMapper;

  @Transactional
  public RepositoryDaemon create(
      String repositoryId,
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Boolean autoStart,
      Integer maxRestarts,
      Boolean otel,
      Integer webViewPort,
      String webViewEntryPath,
      String webViewBasePath,
      Map<String, String> environment,
      List<LogObserver> observers,
      List<LogSource> sources,
      List<HealthCheck> healthChecks) {
    requireNotReservedName(name);
    return upsertFromConfig(
        repositoryId,
        null,
        name,
        description,
        startScript,
        readyPattern,
        stopSignal,
        restartPolicy,
        autoStart,
        maxRestarts,
        otel,
        webViewPort,
        webViewEntryPath,
        webViewBasePath,
        environment,
        observers,
        sources,
        healthChecks);
  }

  /**
   * Declarative upsert used by {@code .qits-config.yml} ingestion (and, with {@code existingId ==
   * null}, by {@link #create}): validates the full definition and overwrites <strong>every</strong>
   * field so the row exactly matches the declaration. Unlike {@link #update} (partial merge), a
   * field the declaration omits is reset to its default — the file is the source of truth. Keeping
   * the same {@code existingId} preserves the daemon id, so its run history survives a re-ingest.
   *
   * <p>Deliberately <strong>not</strong> {@code @Transactional}: it always runs inside a caller's
   * transaction ({@link #create} or the config reconciler), and if it threw as its own
   * transactional boundary a caught validation failure would still mark the reconciler's
   * transaction rollback-only — discarding the valid entries and the warning. As a plain method its
   * exception is an ordinary one the reconciler can catch per entry.
   */
  public RepositoryDaemon upsertFromConfig(
      String repositoryId,
      String existingId,
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Boolean autoStart,
      Integer maxRestarts,
      Boolean otel,
      Integer webViewPort,
      String webViewEntryPath,
      String webViewBasePath,
      Map<String, String> environment,
      List<LogObserver> observers,
      List<LogSource> sources,
      List<HealthCheck> healthChecks) {
    if (name == null || name.isBlank()) {
      throw new BadRequestException("name is required");
    }
    if (startScript == null || startScript.isBlank()) {
      throw new BadRequestException("startScript is required");
    }
    DaemonDefinitionValidator.requireValidRegex(readyPattern, "readyPattern");
    WebView webView =
        DaemonDefinitionValidator.requireValidWebView(
            webViewPort, webViewEntryPath, webViewBasePath);
    DaemonDefinitionValidator.requireValidObservers(observers);
    DaemonDefinitionValidator.requireValidSources(sources);
    DaemonDefinitionValidator.requireValidHealthChecks(healthChecks);

    RepositoryDaemon daemon;
    if (existingId == null) {
      Repository repository =
          repositoryRepository
              .findByIdOptional(repositoryId)
              .orElseThrow(() -> new NotFoundException("Repository not found: " + repositoryId));
      daemon = new RepositoryDaemon();
      daemon.repository = repository;
    } else {
      daemon = get(repositoryId, existingId);
    }
    daemon.name = name;
    daemon.description = description;
    daemon.startScript = startScript;
    daemon.readyPattern = blankToNull(readyPattern);
    daemon.stopSignal = DaemonDefinitionValidator.normalizeStopSignal(stopSignal);
    daemon.restartPolicy = restartPolicy != null ? restartPolicy : RestartPolicy.ON_FAILURE;
    daemon.autoStart = autoStart == null || autoStart;
    daemon.maxRestarts = maxRestarts != null ? maxRestarts : 3;
    daemon.otel = otel != null && otel;
    daemon.webView = webView;
    daemon.environment = environment != null ? new HashMap<>(environment) : new HashMap<>();
    daemon.observers = observers != null ? new ArrayList<>(observers) : new ArrayList<>();
    daemon.sources = sources != null ? new ArrayList<>(sources) : new ArrayList<>();
    daemon.healthChecks = healthChecks != null ? new ArrayList<>(healthChecks) : new ArrayList<>();
    if (existingId == null) {
      repositoryDaemonRepository.persist(daemon);
    }

    return daemon;
  }

  /** The daemon, if it exists and belongs to {@code repositoryId}; 404 otherwise. */
  public RepositoryDaemon get(String repositoryId, String daemonId) {
    RepositoryDaemon daemon =
        repositoryDaemonRepository
            .findByIdOptional(daemonId)
            .orElseThrow(() -> new NotFoundException("RepositoryDaemon not found: " + daemonId));
    if (!daemon.repository.id.equals(repositoryId)) {
      throw new NotFoundException("RepositoryDaemon not found: " + daemonId);
    }
    return daemon;
  }

  public List<RepositoryDaemon> list(String repositoryId) {
    return repositoryDaemonRepository.findByRepositoryId(repositoryId);
  }

  /** The single daemon {@code daemonId} of {@code repositoryId}, flattened for the supervisor. */
  @Transactional
  public RepositoryDaemonDto resolve(String repositoryId, String daemonId) {
    return repositoryDaemonMapper.toDto(get(repositoryId, daemonId));
  }

  /** Every daemon of {@code repositoryId}, flattened for the supervisor. */
  @Transactional
  public List<RepositoryDaemonDto> resolveAll(String repositoryId) {
    return list(repositoryId).stream().map(repositoryDaemonMapper::toDto).toList();
  }

  @Transactional
  public RepositoryDaemon update(
      String repositoryId,
      String daemonId,
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Boolean autoStart,
      Integer maxRestarts,
      Boolean otel,
      Integer webViewPort,
      String webViewEntryPath,
      String webViewBasePath,
      Map<String, String> environment,
      List<LogObserver> observers,
      List<LogSource> sources,
      List<HealthCheck> healthChecks) {
    RepositoryDaemon daemon = get(repositoryId, daemonId);

    if (name != null && !name.isBlank()) {
      requireNotReservedName(name);
      daemon.name = name;
    }
    if (description != null) {
      daemon.description = description;
    }
    if (startScript != null && !startScript.isBlank()) {
      daemon.startScript = startScript;
    }
    if (readyPattern != null) {
      DaemonDefinitionValidator.requireValidRegex(readyPattern, "readyPattern");
      daemon.readyPattern = blankToNull(readyPattern);
    }
    if (stopSignal != null) {
      daemon.stopSignal = DaemonDefinitionValidator.normalizeStopSignal(stopSignal);
    }
    if (restartPolicy != null) {
      daemon.restartPolicy = restartPolicy;
    }
    if (autoStart != null) {
      daemon.autoStart = autoStart;
    }
    if (maxRestarts != null) {
      daemon.maxRestarts = maxRestarts;
    }
    if (otel != null) {
      daemon.otel = otel;
    }
    if (webViewPort != null && webViewPort <= 0) {
      // 0 (or any non-positive port) clears the whole block — the daemon is not web-viewable.
      daemon.webView = null;
    } else if (webViewPort != null || webViewEntryPath != null || webViewBasePath != null) {
      // Per-field merge onto the existing block; a blank/"/" path arg clears that field (the
      // validator normalizes it to null). A port must exist by the end — arg or carried over.
      WebView existing = daemon.webView;
      Integer port = webViewPort != null ? webViewPort : existing != null ? existing.port : null;
      String entryPath =
          webViewEntryPath != null
              ? webViewEntryPath
              : existing != null ? existing.entryPath : null;
      String basePath =
          webViewBasePath != null ? webViewBasePath : existing != null ? existing.basePath : null;
      daemon.webView = DaemonDefinitionValidator.requireValidWebView(port, entryPath, basePath);
    }
    if (environment != null) {
      daemon.environment = new HashMap<>(environment);
    }
    if (observers != null) {
      DaemonDefinitionValidator.requireValidObservers(observers);
      daemon.observers = new ArrayList<>(observers);
    }
    if (sources != null) {
      DaemonDefinitionValidator.requireValidSources(sources);
      daemon.sources = new ArrayList<>(sources);
    }
    if (healthChecks != null) {
      DaemonDefinitionValidator.requireValidHealthChecks(healthChecks);
      daemon.healthChecks = new ArrayList<>(healthChecks);
    }

    return daemon;
  }

  @Transactional
  public void delete(String repositoryId, String daemonId) {
    repositoryDaemonRepository.delete(get(repositoryId, daemonId));
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  /**
   * Rejects a user-supplied name that lands in the {@code .qits-config.yml} namespace. That suffix
   * is reserved for config-declared daemons (written only by {@link #upsertFromConfig}); letting a
   * user create one would make their hand-made daemon look config-managed and get deleted on the
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
}
