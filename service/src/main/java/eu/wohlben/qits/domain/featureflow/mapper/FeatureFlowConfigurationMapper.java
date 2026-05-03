package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta", uses = FeatureFlowPhaseMapper.class)
public interface FeatureFlowConfigurationMapper {

    @Mapping(target = "phases", source = "phases")
    @Mapping(target = "projectId", source = "project.id")
    FeatureFlowConfigurationDto toDto(FeatureFlowConfiguration entity);
}
