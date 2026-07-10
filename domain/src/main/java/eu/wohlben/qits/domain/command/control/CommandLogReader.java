package eu.wohlben.qits.domain.command.control;

import java.time.Instant;
import java.util.List;

/**
 * Read side of the command log — the flip side of {@link CommandLogWriter}, kept framework-free for
 * the same reason. {@link ChatSession#attach} uses it to restore the durable head of a conversation
 * (the imported agent transcript, plus the few error-result lines persisted on {@code OUTPUT}) so a
 * reconnecting client sees the whole transcript, not just recent scrollback.
 */
public interface CommandLogReader {

  /** One persisted row: capture/import sequence, raw content, persistence timestamp. */
  record TimedLine(long seq, String content, Instant timestamp) {}

  /**
   * The command's imported {@code TRANSCRIPT} rows in sequence order (main session only while a
   * chat runs; sidechains join after the exit sweep). Best-effort freshness: rows appear at the
   * live tail's poll cadence.
   */
  List<TimedLine> transcriptLines(String commandId);

  /**
   * {@code OUTPUT} rows with sequence strictly below the bound, in order. For a post-cutover chat
   * these are only the persisted error-result lines; the bound is a live (ring) sequence, so the
   * result can never overlap a ring replay from that bound. Best-effort: lines still sitting in the
   * async write batch are not returned.
   */
  List<TimedLine> outputLinesBefore(String commandId, long sequenceExclusive);
}
