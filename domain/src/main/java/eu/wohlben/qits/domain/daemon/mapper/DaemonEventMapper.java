package eu.wohlben.qits.domain.daemon.mapper;

import eu.wohlben.qits.domain.daemon.dto.DaemonEventDto;
import eu.wohlben.qits.domain.daemon.entity.DaemonEvent;
import org.mapstruct.Mapper;

@Mapper(componentModel = "jakarta")
public interface DaemonEventMapper {

  DaemonEventDto toDto(DaemonEvent event);
}
