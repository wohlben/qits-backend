package eu.wohlben.qits.domain.daemon.dto;

import eu.wohlben.qits.domain.daemon.entity.LogObserverKind;
import eu.wohlben.qits.domain.service.entity.ServiceEventSeverity;

/** One observer of a daemon definition, as returned to clients. */
public record LogObserverDto(LogObserverKind kind, String pattern, ServiceEventSeverity severity) {}
