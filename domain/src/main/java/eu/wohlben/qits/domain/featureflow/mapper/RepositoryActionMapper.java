package eu.wohlben.qits.domain.featureflow.mapper;

import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.entity.RepositoryAction;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface RepositoryActionMapper {

  @Mapping(target = "scope", constant = "REPOSITORY")
  @Mapping(target = "repositoryId", source = "repository.id")
  ActionConfigurationDto toDto(RepositoryAction entity);
}
