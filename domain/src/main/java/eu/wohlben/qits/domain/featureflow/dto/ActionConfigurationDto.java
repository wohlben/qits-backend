package eu.wohlben.qits.domain.featureflow.dto;

public record ActionConfigurationDto(
    String id, String name, String description, String executeScript, String checkScript) {}
