package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;

/** What a log observer saw: the classification plus the evidence. */
public record ObserverFinding(
    DaemonEventSeverity severity, String errorType, String summary, String logExcerpt) {}
