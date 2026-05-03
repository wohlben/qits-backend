package eu.wohlben.qits.domain.featureflow.dto;

import java.util.List;

public record FeatureFlowConfigurationDto(
    String id,
    String name,
    String projectId,
    List<FeatureFlowPhaseDto> phases
) {}
