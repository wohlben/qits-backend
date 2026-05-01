package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowConfiguration;
import org.mapstruct.Mapper;

@Mapper(componentModel = "cdi")
public interface FeatureFlowConfigurationMapper {

    FeatureFlowConfigurationDto toDto(FeatureFlowConfiguration entity);
}
