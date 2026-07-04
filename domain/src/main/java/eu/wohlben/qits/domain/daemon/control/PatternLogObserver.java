package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.daemon.entity.DaemonEventSeverity;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * The PATTERN observer: every output line matching the regex becomes an {@code ERROR_DETECTED}
 * finding with the configured severity and the line as evidence. Throttled so a crash-looping
 * daemon doesn't flood the event feed (and the agent's chat) with one event per line.
 */
final class PatternLogObserver extends LineFramingSink {

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
  protected void onLine(String line) {
    if (!pattern.matcher(line).find()) {
      return;
    }
    long now = System.currentTimeMillis();
    if (now - lastEmitMillis < THROTTLE_MILLIS) {
      return;
    }
    lastEmitMillis = now;
    onFinding.accept(
        new ObserverFinding(severity, "pattern:" + pattern.pattern(), line.strip(), line));
  }
}
