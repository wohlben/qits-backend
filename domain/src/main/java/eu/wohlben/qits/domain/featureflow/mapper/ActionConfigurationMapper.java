package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import org.mapstruct.Mapper;

@Mapper(componentModel = "jakarta")
public interface ActionConfigurationMapper {

  ActionConfigurationDto toDto(ActionConfiguration entity);
}
