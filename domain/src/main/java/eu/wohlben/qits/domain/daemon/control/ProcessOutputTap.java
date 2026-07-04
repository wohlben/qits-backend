package eu.wohlben.qits.domain.daemon.control;

import eu.wohlben.qits.domain.command.control.CommandLogWriter;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import java.time.Instant;
import java.util.List;

/**
 * Feeds a daemon's observers from the process output — as a tee on the session's {@link
 * CommandLogWriter} rather than a raw-chunk sink, because the session's framing is the one that
 * assigns {@code command_log_line} sequences: an observed line's {@code position} is exactly the
 * persisted line's {@code seq}, which is what makes output anchors resolvable against the audit
 * log. OUTPUT lines only; ANSI escapes are stripped and blank lines skipped before observers see
 * them (positions are still consumed by skipped lines, so anchors stay true).
 */
final class ProcessOutputTap implements CommandLogWriter {

  private final List<ObservedLineListener> listeners;

  ProcessOutputTap(List<ObservedLineListener> listeners) {
    this.listeners = List.copyOf(listeners);
  }

  @Override
  public void append(
      String commandId, long sequence, LogChannel channel, String content, Instant timestamp) {
    if (channel != LogChannel.OUTPUT) {
      return;
    }
    String cleaned = LineFramingSink.stripAnsi(content);
    if (cleaned.isBlank()) {
      return;
    }
    ObservedLine line = new ObservedLine(ObservedLine.PROCESS_OUTPUT, sequence, null, cleaned);
    for (ObservedLineListener listener : listeners) {
      listener.onLine(line);
    }
  }
}
