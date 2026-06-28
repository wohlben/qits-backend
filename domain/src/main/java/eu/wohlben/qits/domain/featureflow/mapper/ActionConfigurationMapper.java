package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface ActionConfigurationMapper {

  @Mapping(target = "scope", constant = "GLOBAL")
  @Mapping(target = "repositoryId", ignore = true)
  ActionConfigurationDto toDto(ActionConfiguration entity);
}
