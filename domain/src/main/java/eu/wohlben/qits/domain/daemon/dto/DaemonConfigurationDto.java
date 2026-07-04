package eu.wohlben.qits.domain.daemon.dto;

import eu.wohlben.qits.domain.daemon.entity.DaemonScope;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import java.util.List;
import java.util.Map;

/**
 * A daemon definition of either scope; {@code repositoryId} is null for GLOBAL ones. One shape for
 * both scopes, mirroring {@code ActionConfigurationDto}.
 */
public record DaemonConfigurationDto(
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
    List<LogSourceDto> sources) {}
