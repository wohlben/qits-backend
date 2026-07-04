package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.dto.DaemonConfigurationDto;
import eu.wohlben.qits.domain.daemon.dto.LogObserverDto;
import eu.wohlben.qits.domain.daemon.dto.LogSourceDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonScope;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.mapper.DaemonConfigurationMapper;
import eu.wohlben.qits.domain.daemon.mapper.RepositoryDaemonMapper;
import eu.wohlben.qits.domain.daemon.persistence.DaemonConfigurationRepository;
import eu.wohlben.qits.domain.daemon.persistence.RepositoryDaemonRepository;
import eu.wohlben.qits.domain.error.NotFoundException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Resolves which daemons are available in a repository (global ∪ repository, like {@code
 * ActionResolutionService.effectiveActions}) and flattens a single definition for the supervisor.
 */
@ApplicationScoped
public class DaemonResolutionService {

  @Inject DaemonConfigurationRepository daemonConfigurationRepository;

  @Inject RepositoryDaemonRepository repositoryDaemonRepository;

  @Inject DaemonConfigurationMapper daemonConfigurationMapper;

  @Inject RepositoryDaemonMapper repositoryDaemonMapper;

  /** Everything the supervisor needs to run one daemon, independent of its scope. */
  public record ResolvedDaemon(
      String id,
      String name,
      String description,
      String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      int maxRestarts,
      DaemonScope scope,
      String repositoryId,
      Map<String, String> environment,
      List<LogObserverDto> observers,
      List<LogSourceDto> sources) {

    static ResolvedDaemon of(DaemonConfigurationDto dto) {
      return new ResolvedDaemon(
          dto.id(),
          dto.name(),
          dto.description(),
          dto.startScript(),
          dto.readyPattern(),
          dto.stopSignal(),
          dto.restartPolicy(),
          dto.maxRestarts(),
          dto.scope(),
          dto.repositoryId(),
          dto.environment(),
          dto.observers(),
          dto.sources());
    }
  }

  /** Every daemon available in {@code repositoryId}: global ones plus the repository's own. */
  @Transactional
  public List<DaemonConfigurationDto> effectiveDaemons(String repositoryId) {
    List<DaemonConfigurationDto> daemons = new ArrayList<>();
    daemonConfigurationRepository.listAll().stream()
        .map(daemonConfigurationMapper::toDto)
        .forEach(daemons::add);
    repositoryDaemonRepository.findByRepositoryId(repositoryId).stream()
        .map(repositoryDaemonMapper::toDto)
        .forEach(daemons::add);
    return daemons;
  }

  /**
   * The single definition {@code daemonId} as available in {@code repositoryId}: global first, then
   * the repository's own; a daemon owned by a different repository is a 404.
   */
  @Transactional
  public ResolvedDaemon resolveForRepository(String repositoryId, String daemonId) {
    return daemonConfigurationRepository
        .findByIdOptional(daemonId)
        .map(daemonConfigurationMapper::toDto)
        .or(
            () ->
                repositoryDaemonRepository
                    .findByIdOptional(daemonId)
                    .filter(daemon -> daemon.repository.id.equals(repositoryId))
                    .map(repositoryDaemonMapper::toDto))
        .map(ResolvedDaemon::of)
        .orElseThrow(() -> new NotFoundException("Daemon not found: " + daemonId));
  }
}
