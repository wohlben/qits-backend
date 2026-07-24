package eu.wohlben.qits.domain.featureflow.dto;

import java.util.Map;

/**
 * A runnable, code-based (global) action. Config-declared actions live only in the workspace's
 * committed {@code .qits-config.yml} and surface via the workspace actions endpoint, not here.
 */
public record ActionConfigurationDto(
    String id,
    String name,
    String description,
    String executeScript,
    String checkScript,
    boolean interactive,
    Map<String, String> environment) {}
