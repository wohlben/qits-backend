package eu.wohlben.qits.domain.daemon.dto;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;

/** One observer of a daemon definition, as returned to clients. */
public record LogObserverDto(LogObserverKind kind, String pattern, DaemonEventSeverity severity) {}
