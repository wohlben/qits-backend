package eu.wohlben.qits.domain.command.mapper;

import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.entity.Command;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface CommandMapper {

  @Mapping(target = "repoId", source = "workspace.repository.id")
  @Mapping(target = "workspaceId", source = "workspace.workspaceId")
  @Mapping(
      target = "shortCommitHash",
      expression =
          "java(entity.commitHash != null && entity.commitHash.length() >= 7"
              + " ? entity.commitHash.substring(0, 7) : entity.commitHash)")
  CommandDto toDto(Command entity);
}
