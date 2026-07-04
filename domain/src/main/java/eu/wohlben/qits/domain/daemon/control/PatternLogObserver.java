package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * The PATTERN observer: every observed line matching the regex becomes an {@code ERROR_DETECTED}
 * finding with the configured severity, the line as evidence, and the line's place in its source as
 * the anchor. Throttled so a crash-looping daemon doesn't flood the event feed (and the agent's
 * chat) with one event per line. One instance per (observer, source).
 */
final class PatternLogObserver implements ObservedLineListener {

  /** At most one finding per observer per this interval; suppressed matches are dropped. */
  private static final long THROTTLE_MILLIS = 10_000;

  private final Pattern pattern;
  private final DaemonEventSeverity severity;
  private final Consumer<ObserverFinding> onFinding;
  private long lastEmitMillis;

  PatternLogObserver(
      Pattern pattern, DaemonEventSeverity severity, Consumer<ObserverFinding> onFinding) {
    this.pattern = pattern;
    this.severity = severity;
    this.onFinding = onFinding;
  }

  @Override
  public synchronized void onLine(ObservedLine line) {
    if (!pattern.matcher(line.content()).find()) {
      return;
    }
    long now = System.currentTimeMillis();
    if (now - lastEmitMillis < THROTTLE_MILLIS) {
      return;
    }
    lastEmitMillis = now;
    onFinding.accept(
        new ObserverFinding(
            severity,
            "pattern:" + pattern.pattern(),
            line.content().strip(),
            line.content(),
            line.source(),
            line.position(),
            line.position(),
            line.sourceEpoch()));
  }
}
