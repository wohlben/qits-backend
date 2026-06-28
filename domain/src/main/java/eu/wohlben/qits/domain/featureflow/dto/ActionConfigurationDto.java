package eu.wohlben.qits.domain.featureflow.dto;

import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import java.util.Map;

/**
 * A runnable action, of either scope. {@code scope} says where it lives ({@code GLOBAL} or {@code
 * REPOSITORY}); {@code repositoryId} is set only for repository-scoped actions. The same shape is
 * returned for both so every consumer (the Run… picker, the MCP tools) is uniform.
 */
public record ActionConfigurationDto(
    String id,
    String name,
    String description,
    String executeScript,
    String checkScript,
    boolean interactive,
    ActionVariant variant,
    ActionScope scope,
    String repositoryId,
    Map<String, String> environment) {}
