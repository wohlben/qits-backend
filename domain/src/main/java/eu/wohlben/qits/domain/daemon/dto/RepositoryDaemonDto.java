package eu.wohlben.qits.domain.daemon.dto;

import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import java.util.List;
import java.util.Map;

/** A repository-owned daemon definition — everything the supervisor needs to run it. */
public record RepositoryDaemonDto(
    String id,
    String name,
    String description,
    String startScript,
    String readyPattern,
    String stopSignal,
    RestartPolicy restartPolicy,
    int maxRestarts,
    String repositoryId,
    Map<String, String> environment,
    List<LogObserverDto> observers,
    List<LogSourceDto> sources) {}
