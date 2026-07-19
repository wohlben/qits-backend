package eu.wohlben.qits.domain.bootstrap.dto;

import eu.wohlben.qits.domain.repository.control.QitsConfig;
import java.time.Instant;
import java.util.Map;

/**
 * One step of a repository's bootstrap chain. {@code origin} says whether it was hand-made in the
 * UI or declared in {@code .qits-config.yml} (config-origin commands render read-only); its {@code
 * name} carries the {@code @qits-config} suffix in that case.
 */
public record BootstrapCommandDto(
    String id,
    String name,
    String description,
    String executeScript,
    String checkScript,
    int orderIndex,
    QitsConfig.Origin origin,
    String repositoryId,
    Map<String, String> environment,
    Instant createdAt,
    Instant updatedAt) {}
