package eu.wohlben.qits.domain.bootstrap.mapper;

import eu.wohlben.qits.domain.bootstrap.dto.BootstrapCommandDto;
import eu.wohlben.qits.domain.bootstrap.dto.BootstrapRunDto;
import eu.wohlben.qits.domain.bootstrap.entity.BootstrapCommand;
import eu.wohlben.qits.domain.bootstrap.entity.BootstrapRun;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta", imports = QitsConfig.class)
public interface BootstrapCommandMapper {

  @Mapping(target = "origin", expression = "java(QitsConfig.originOf(command.name))")
  @Mapping(target = "repositoryId", source = "repository.id")
  BootstrapCommandDto toDto(BootstrapCommand command);

  BootstrapRunDto toDto(BootstrapRun run);
}
