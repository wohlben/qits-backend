package eu.wohlben.qits.domain.featureflow.dto;

import java.util.List;

public record FeatureFlowPhaseStepDto(
    String id,
    String name,
    int sortOrder,
    List<FeatureFlowPhaseActionDto> actions
) {}
