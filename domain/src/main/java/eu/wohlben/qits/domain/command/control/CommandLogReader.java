package eu.wohlben.qits.domain.command.control;

import java.util.List;

/**
 * Read side of the command log — the flip side of {@link CommandLogWriter}, kept framework-free for
 * the same reason. {@link ChatSession#attach} uses it to restore the persisted head of a
 * conversation (lines already evicted from the in-memory ring) so a reconnecting client sees the
 * whole transcript, not just recent scrollback.
 */
public interface CommandLogReader {

  /**
   * The persisted log lines of {@code commandId} with sequence strictly below {@code
   * sequenceExclusive}, ordered by sequence. Best-effort: lines still sitting in the async write
   * batch are not returned.
   */
  List<String> linesBefore(String commandId, long sequenceExclusive);
}
