package eu.wohlben.qits.domain.action.mapper;

import eu.wohlben.qits.domain.action.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.action.entity.ActionConfiguration;
import org.mapstruct.Mapper;

@Mapper(componentModel = "cdi")
public interface ActionConfigurationMapper {

    ActionConfigurationDto toDto(ActionConfiguration entity);
}
