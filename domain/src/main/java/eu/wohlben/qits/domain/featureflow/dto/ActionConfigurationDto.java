package eu.wohlben.qits.domain.featureflow.dto;

import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import java.util.Map;

/**
 * A runnable action, of either scope. {@code scope} says where it lives ({@code GLOBAL} or {@code
 * REPOSITORY}); {@code repositoryId} is set only for repository-scoped actions. {@code origin} says
 * whether it was hand-made in the UI or declared in {@code .qits-config.yml} (config-origin entries
 * render read-only); its {@code name} carries the {@code @qits-config} suffix in that case. The
 * same shape is returned for both so every consumer (the Run… picker, the MCP tools) is uniform.
 */
public record ActionConfigurationDto(
    String id,
    String name,
    String description,
    String executeScript,
    String checkScript,
    boolean interactive,
    ActionScope scope,
    QitsConfig.Origin origin,
    String repositoryId,
    Map<String, String> environment) {}
