package eu.wohlben.qits.domain.repository.mapper;

import eu.wohlben.qits.domain.repository.dto.WorktreeDto;
import eu.wohlben.qits.domain.repository.entity.Worktree;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "jakarta")
public interface WorktreeMapper {

  @Mapping(source = "parent", target = "parent")
  @Mapping(target = "branch", ignore = true)
  WorktreeDto toDto(Worktree entity);
}
