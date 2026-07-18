package eu.wohlben.qits.domain.daemon.dto;

import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import java.util.List;
import java.util.Map;

/**
 * A repository-owned daemon definition — everything the supervisor needs to run it. {@code origin}
 * says whether it was hand-made in the UI or declared in {@code .qits-config.yml} (config-origin
 * daemons render read-only); its {@code name} carries the {@code @qits-config} suffix in that case.
 */
public record RepositoryDaemonDto(
    String id,
    String name,
    String description,
    String startScript,
    String readyPattern,
    String stopSignal,
    RestartPolicy restartPolicy,
    boolean autoStart,
    int maxRestarts,
    boolean otel,
    WebViewDto webView,
    QitsConfig.Origin origin,
    String repositoryId,
    Map<String, String> environment,
    List<LogObserverDto> observers,
    List<LogSourceDto> sources,
    List<HealthCheckDto> healthChecks) {}
