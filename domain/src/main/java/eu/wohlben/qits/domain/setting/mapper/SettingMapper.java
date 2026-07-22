package eu.wohlben.qits.domain.setting.mapper;

import eu.wohlben.qits.domain.setting.dto.SettingDto;
import eu.wohlben.qits.domain.setting.entity.Setting;
import org.mapstruct.Mapper;

@Mapper(componentModel = "jakarta")
public interface SettingMapper {

  SettingDto toDto(Setting entity);
}
