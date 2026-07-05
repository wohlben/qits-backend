package eu.wohlben.qits.domain.daemon.control;

import java.time.Instant;

/**
 * One clean (non-blank, ANSI-stripped) line an observer sees, qualified with where it came from so
 * findings can anchor to their exact place in the source:
 *
 * <ul>
 *   <li>process output — {@code source} is {@link #PROCESS_OUTPUT} and {@code position} is the
 *       line's {@code command_log_line} sequence (the lines are already persisted there);
 *   <li>a tailed file — {@code source} is the workspace-relative path, {@code position} is the
 *       1-based line number in the file since the last rotation, and {@code sourceEpoch} marks when
 *       the tail (re)opened the file so a rolled file doesn't mislead.
 * </ul>
 */
public record ObservedLine(String source, long position, Instant sourceEpoch, String content) {

  /** The {@code source} value of the implicit process-output stream. */
  public static final String PROCESS_OUTPUT = "output";
}
