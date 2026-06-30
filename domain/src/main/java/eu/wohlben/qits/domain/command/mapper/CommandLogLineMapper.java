package eu.wohlben.qits.domain.command.mapper;

import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandLogLine;
import org.mapstruct.Mapper;

@Mapper(componentModel = "jakarta")
public interface CommandLogLineMapper {

  CommandLogLineDto toDto(CommandLogLine entity);
}
