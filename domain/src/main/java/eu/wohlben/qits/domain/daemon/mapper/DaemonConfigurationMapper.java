package eu.wohlben.qits.domain.daemon.mapper;

import eu.wohlben.qits.domain.daemon.dto.DaemonConfigurationDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonConfiguration;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface DaemonConfigurationMapper {

  @Mapping(target = "scope", constant = "GLOBAL")
  @Mapping(target = "repositoryId", ignore = true)
  DaemonConfigurationDto toDto(DaemonConfiguration configuration);
}
