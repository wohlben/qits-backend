package eu.wohlben.qits.domain.featureflow.dto;

import java.util.List;

public record FeatureFlowPhaseDto(
    String id,
    String name,
    String description,
    int orderIndex,
    String featureFlowConfigurationId,
    String parentPhaseId,
    List<FeatureFlowPhaseStepDto> steps,
    List<FeatureFlowPhaseDto> subPhases
) {}
