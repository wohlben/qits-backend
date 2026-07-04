package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import java.time.Instant;

/**
 * What a log observer saw: the classification, the evidence, and where the evidence sits in its
 * source. {@code anchorFrom}/{@code anchorTo} bound the excerpt's lines — {@code command_log_line}
 * sequences for process output, 1-based line numbers (since the rotation marked by {@code
 * sourceEpoch}) for a tailed file.
 */
public record ObserverFinding(
    DaemonEventSeverity severity,
    String errorType,
    String summary,
    String logExcerpt,
    String source,
    long anchorFrom,
    long anchorTo,
    Instant sourceEpoch) {}
