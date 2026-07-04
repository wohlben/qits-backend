package eu.wohlben.qits.domain.daemon.mapper;

import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.RepositoryDaemon;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface RepositoryDaemonMapper {

  @Mapping(target = "repositoryId", source = "repository.id")
  RepositoryDaemonDto toDto(RepositoryDaemon daemon);
}
