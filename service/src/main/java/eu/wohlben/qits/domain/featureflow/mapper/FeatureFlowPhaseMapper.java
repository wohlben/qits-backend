package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseActionDto;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseDto;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseStepDto;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

import java.util.Comparator;
import java.util.List;

@Mapper(componentModel = "cdi", uses = ActionConfigurationMapper.class)
public interface FeatureFlowPhaseMapper {

    @Mapping(target = "featureFlowConfigurationId", source = "featureFlowConfiguration.id")
    @Mapping(target = "parentPhaseId", source = "parentPhase.id")
    @Mapping(target = "steps", expression = "java(mapSteps(entity))")
    @Mapping(target = "subPhases", expression = "java(mapSubPhases(entity))")
    FeatureFlowPhaseDto toDto(FeatureFlowPhase entity);

    default List<FeatureFlowPhaseStepDto> mapSteps(FeatureFlowPhase phase) {
        if (phase.steps == null) {
            return List.of();
        }
        return phase.steps.stream()
            .sorted(Comparator.comparingInt(s -> s.sortOrder))
            .map(this::toStepDto)
            .toList();
    }

    @Mapping(target = "actions", expression = "java(mapActions(entity))")
    FeatureFlowPhaseStepDto toStepDto(FeatureFlowPhaseStep entity);

    default List<FeatureFlowPhaseActionDto> mapActions(FeatureFlowPhaseStep step) {
        if (step.actions == null) {
            return List.of();
        }
        return step.actions.stream()
            .sorted(Comparator.comparingInt(a -> a.sortOrder))
            .map(this::toActionDto)
            .toList();
    }

    @Mapping(target = "stepId", source = "step.id")
    FeatureFlowPhaseActionDto toActionDto(FeatureFlowPhaseAction entity);

    default List<FeatureFlowPhaseDto> mapSubPhases(FeatureFlowPhase phase) {
        if (phase.subPhases == null) {
            return List.of();
        }
        return phase.subPhases.stream()
            .sorted(Comparator.comparingInt(p -> p.orderIndex))
            .map(this::toDto)
            .toList();
    }
}
