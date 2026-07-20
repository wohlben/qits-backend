package eu.wohlben.qits.domain.repository.mapper;

import eu.wohlben.qits.domain.repository.dto.WorkspacePromptAttachmentDto;
import eu.wohlben.qits.domain.repository.entity.WorkspacePromptAttachment;
import org.mapstruct.Mapper;

@Mapper(componentModel = "jakarta")
public interface WorkspacePromptAttachmentMapper {

  WorkspacePromptAttachmentDto toDto(WorkspacePromptAttachment entity);
}
