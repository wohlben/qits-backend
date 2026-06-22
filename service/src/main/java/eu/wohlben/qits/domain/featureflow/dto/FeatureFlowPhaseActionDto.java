package eu.wohlben.qits.domain.featureflow.dto;

import eu.wohlben.qits.domain.featureflow.entity.ActionType;

public record FeatureFlowPhaseActionDto(
    String id,
    String stepId,
    ActionConfigurationDto actionConfiguration,
    ActionType actionType,
    int sortOrder,
    String parallelGroup) {}
