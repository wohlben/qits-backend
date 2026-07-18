package eu.wohlben.qits.domain.repository.control;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogSource;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.daemon.persistence.RepositoryDaemonRepository;
import eu.wohlben.qits.domain.error.DomainException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import eu.wohlben.qits.domain.repository.control.QitsConfig.ActionDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfig.DaemonDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfig.HealthCheckDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfig.ObserverDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfig.SourceDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfig.WebViewDecl;
import eu.wohlben.qits.domain.repository.control.QitsConfigParser.QitsConfigException;
import eu.wohlben.qits.domain.repository.entity.Repository;
import eu.wohlben.qits.domain.repository.persistence.RepositoryRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Reconciles a repository's committed {@code .qits-config.yml} into the existing tables (see {@code
 * docs/features/2026-07-18_qits-config-in-repo-configuration.md}). Called on clone and on sync of
 * the main branch, plus via the explicit reload endpoint.
 *
 * <p>Declared config coexists with hand-made (UI) config: declared entries are namespaced by {@link
 * QitsConfig#CONFIG_NAME_SUFFIX}, and the write API rejects that suffix in user input, so a
 * declared name can never collide with a UI one — reconciliation only ever touches config-origin
 * rows. The file is the source of truth for those rows: declared∧present → overwrite in place (same
 * id, so feature-flow bindings and run history survive), declared∧absent → insert,
 * present∧undeclared → delete.
 *
 * <p>"Degrade loudly, never block": a parse error, or a single invalid entry, never fails the
 * clone/sync — the last-good rows are kept and the problem is recorded in {@link
 * Repository#configWarning}, shown as a repository-level warning in the UI.
 */
@ApplicationScoped
public class QitsConfigReconciler {

  private static final Logger LOG = Logger.getLogger(QitsConfigReconciler.class);

  @Inject QitsConfigParser parser;

  @Inject RepositoryRepository repositoryRepository;

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject RepositoryDaemonRepository repositoryDaemonRepository;

  @ConfigProperty(name = "qits.repositories.data-dir", defaultValue = "data/repositories")
  String dataDir;

  /** Reads and reconciles {@code repoId}'s config from its bare origin at the main branch. */
  @Transactional
  public void ingest(String repoId) {
    Repository repo =
        repositoryRepository
            .findByIdOptional(repoId)
            .orElseThrow(() -> new NotFoundException("Repository not found: " + repoId));

    File origin = Path.of(dataDir, repoId, "origin").toFile();
    List<String> warnings = new ArrayList<>();

    QitsConfig config;
    try {
      config = parser.readConfig(origin, repo.mainBranch);
      // The file may declare a different main branch than the one it was read from; if so, adopt it
      // (file wins) and re-read the config from there once — the bootstrap the feature doc
      // describes.
      if (config.repository() != null) {
        String declared = config.repository().mainBranch();
        if (declared != null && !declared.isBlank() && !declared.equals(repo.mainBranch)) {
          repo.mainBranch = declared;
          config = parser.readConfig(origin, declared);
        }
      }
    } catch (QitsConfigException e) {
      // A structurally invalid file: keep every last-good row, record the warning, stop.
      LOG.warnf(
          "Invalid %s in repository %s: %s", QitsConfigParser.CONFIG_PATH, repoId, e.getMessage());
      repo.configWarning =
          "Failed to parse " + QitsConfigParser.CONFIG_PATH + ": " + e.getMessage();
      return;
    }

    // Repository-level fields the file may own (file wins). main-branch was applied above.
    if (config.repository() != null && config.repository().archetype() != null) {
      repo.archetype = config.repository().archetype();
    }

    reconcileActions(repo, config.actions(), warnings);
    reconcileDaemons(repo, config.daemons(), warnings);

    repo.configWarning = warnings.isEmpty() ? null : String.join("\n", warnings);
  }

  /** Public entry point for the manual reload endpoint. */
  @Transactional
  public void reload(String repoId) {
    ingest(repoId);
  }

  private void reconcileActions(Repository repo, List<ActionDecl> declared, List<String> warnings) {
    Map<String, ActionConfiguration> existing = new LinkedHashMap<>();
    for (ActionConfiguration a : actionConfigurationRepository.listByRepositoryId(repo.id)) {
      if (QitsConfig.isConfigName(a.name)) {
        existing.put(a.name, a);
      }
    }

    Set<String> declaredNames = new LinkedHashSet<>();
    for (ActionDecl d : declared) {
      String stored = QitsConfig.configName(d.name());
      if (!declaredNames.add(stored)) {
        warnings.add("action '" + d.name() + "': duplicate name, only the first is applied");
        continue;
      }
      ActionConfiguration current = existing.get(stored);
      try {
        actionConfigurationService.upsertFromConfig(
            repo.id,
            current == null ? null : current.id,
            stored,
            d.description(),
            d.execute(),
            d.check(),
            d.interactive(),
            d.environment());
      } catch (DomainException e) {
        warnings.add("action '" + d.name() + "': " + e.getMessage());
      }
    }

    // Delete config-origin actions no longer declared. A still-bound action is kept (the
    // phase-action FK has no cascade, so deleting it would fail the whole ingest) and surfaced as a
    // warning — unbind it in the feature flow first, or restore it in the file.
    for (Map.Entry<String, ActionConfiguration> e : existing.entrySet()) {
      if (declaredNames.contains(e.getKey())) {
        continue;
      }
      if (featureFlowPhaseActionService.isActionBound(e.getValue().id)) {
        warnings.add(
            "action '"
                + QitsConfig.baseName(e.getKey())
                + "' was removed from the file but is still bound to a feature flow; kept");
        continue;
      }
      // Delete through the Panache repository (not the @Transactional service method) so a failure
      // never marks the reconciler's transaction rollback-only.
      actionConfigurationRepository.delete(e.getValue());
    }
  }

  private void reconcileDaemons(Repository repo, List<DaemonDecl> declared, List<String> warnings) {
    Map<String, RepositoryDaemon> existing = new LinkedHashMap<>();
    for (RepositoryDaemon d : repositoryDaemonRepository.findByRepositoryId(repo.id)) {
      if (QitsConfig.isConfigName(d.name)) {
        existing.put(d.name, d);
      }
    }

    Set<String> declaredNames = new LinkedHashSet<>();
    for (DaemonDecl d : declared) {
      String stored = QitsConfig.configName(d.name());
      if (!declaredNames.add(stored)) {
        warnings.add("daemon '" + d.name() + "': duplicate name, only the first is applied");
        continue;
      }
      RepositoryDaemon current = existing.get(stored);
      WebViewDecl wv = d.webView();
      try {
        repositoryDaemonService.upsertFromConfig(
            repo.id,
            current == null ? null : current.id,
            stored,
            d.description(),
            d.start(),
            d.readyPattern(),
            d.stopSignal(),
            d.restartPolicy(),
            d.autoStart(),
            d.maxRestarts(),
            d.otel(),
            wv == null ? null : wv.port(),
            wv == null ? null : wv.entryPath(),
            wv == null ? null : wv.basePath(),
            d.environment(),
            observers(d.observers()),
            sources(d.sources()),
            healthChecks(d.healthChecks()));
      } catch (DomainException e) {
        warnings.add("daemon '" + d.name() + "': " + e.getMessage());
      }
    }

    // Delete config-origin daemons no longer declared (row removal; a running per-workspace
    // instance
    // settles via the existing container-stopping coupling, as with a UI delete). Deleted through
    // the Panache repository (not the @Transactional service method) so a failure never marks the
    // reconciler's transaction rollback-only.
    for (Map.Entry<String, RepositoryDaemon> e : existing.entrySet()) {
      if (!declaredNames.contains(e.getKey())) {
        repositoryDaemonRepository.delete(e.getValue());
      }
    }
  }

  private static List<LogObserver> observers(List<ObserverDecl> decls) {
    List<LogObserver> out = new ArrayList<>();
    if (decls == null) {
      return out;
    }
    for (ObserverDecl o : decls) {
      out.add(new LogObserver(o.kind(), o.pattern(), o.severity()));
    }
    return out;
  }

  private static List<LogSource> sources(List<SourceDecl> decls) {
    List<LogSource> out = new ArrayList<>();
    if (decls == null) {
      return out;
    }
    for (SourceDecl s : decls) {
      out.add(new LogSource(s.path(), s.label()));
    }
    return out;
  }

  private static List<HealthCheck> healthChecks(List<HealthCheckDecl> decls) {
    List<HealthCheck> out = new ArrayList<>();
    if (decls == null) {
      return out;
    }
    for (HealthCheckDecl h : decls) {
      out.add(
          new HealthCheck(
              h.name(),
              h.kind(),
              h.port(),
              h.path(),
              h.expectStatus(),
              h.command(),
              h.intervalMs(),
              h.timeoutMs(),
              h.healthyThreshold(),
              h.unhealthyThreshold(),
              h.initialDelayMs()));
    }
    return out;
  }
}
