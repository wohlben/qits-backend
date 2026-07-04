package eu.wohlben.qits.domain.daemon.control;

/**
 * A consumer of {@link ObservedLine}s. Observers implement this instead of the registry's raw-chunk
 * sink so PATTERN and LOG_LEVEL behave identically regardless of where lines come from (the PTY
 * stream or a tailed file); producers ({@code ProcessOutputTap}, {@code FileTailSource}) own the
 * framing and source qualification. One observer instance watches exactly one source — that keeps
 * LOG_LEVEL batches anchorable to a contiguous range of a single source.
 */
interface ObservedLineListener {

  void onLine(ObservedLine line);
}
