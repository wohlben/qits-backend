package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.command.entity.LogChannel;
import java.time.Instant;

/**
 * Sink for captured command log lines. Kept framework-free (like {@link CommandOutputSink}) so the
 * registry/session can call it from the domain module without depending on persistence. The real
 * implementation ({@code CommandLogService}) buffers and persists asynchronously; the session
 * assigns {@code sequence} and {@code timestamp} at capture time so order and timing survive the
 * async write.
 */
public interface CommandLogWriter {

  void append(
      String commandId, long sequence, LogChannel channel, String content, Instant timestamp);
}
