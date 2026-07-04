package eu.wohlben.qits.domain.daemon.api;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserver;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** One observer as submitted by clients; shared by the global and repo-scoped daemon requests. */
public record LogObserverInput(
    @NotNull LogObserverKind kind, String pattern, DaemonEventSeverity severity) {

  public LogObserver toEntity() {
    return new LogObserver(kind, pattern, severity);
  }

  /** Null stays null (meaning "keep as-is" on update); a present list is converted wholesale. */
  public static List<LogObserver> toEntities(List<LogObserverInput> observers) {
    return observers == null ? null : observers.stream().map(LogObserverInput::toEntity).toList();
  }
}
