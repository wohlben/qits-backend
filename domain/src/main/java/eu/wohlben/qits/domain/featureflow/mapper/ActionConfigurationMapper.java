package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.entity.ActionScope;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(
    componentModel = "jakarta",
    imports = {ActionScope.class, QitsConfig.class})
public interface ActionConfigurationMapper {

  @Mapping(
      target = "scope",
      expression = "java(entity.repository == null ? ActionScope.GLOBAL : ActionScope.REPOSITORY)")
  @Mapping(target = "origin", expression = "java(QitsConfig.originOf(entity.name))")
  @Mapping(target = "repositoryId", source = "repository.id")
  ActionConfigurationDto toDto(ActionConfiguration entity);
}
