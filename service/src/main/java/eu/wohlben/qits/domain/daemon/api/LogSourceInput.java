package eu.wohlben.qits.domain.daemon.api;

import eu.wohlben.qits.domain.daemon.entity.LogSource;
import jakarta.validation.constraints.NotBlank;
import java.util.List;

/** One FILE log source as submitted by clients; shared by both daemon definition scopes. */
public record LogSourceInput(@NotBlank String path, String label) {

  public LogSource toEntity() {
    return new LogSource(path, label);
  }

  /** Null stays null (meaning "keep as-is" on update); a present list is converted wholesale. */
  public static List<LogSource> toEntities(List<LogSourceInput> sources) {
    return sources == null ? null : sources.stream().map(LogSourceInput::toEntity).toList();
  }
}
