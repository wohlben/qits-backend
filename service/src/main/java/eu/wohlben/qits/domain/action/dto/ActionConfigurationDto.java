package eu.wohlben.qits.domain.action.dto;

public record ActionConfigurationDto(
    String id,
    String name,
    String description,
    String executeScript,
    String checkScript
) {}
