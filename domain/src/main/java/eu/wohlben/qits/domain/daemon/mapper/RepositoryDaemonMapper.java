package eu.wohlben.qits.domain.daemon.mapper;

import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta", imports = QitsConfig.class)
public interface RepositoryDaemonMapper {

  @Mapping(target = "origin", expression = "java(QitsConfig.originOf(daemon.name))")
  @Mapping(target = "repositoryId", source = "repository.id")
  RepositoryDaemonDto toDto(RepositoryDaemon daemon);
}
