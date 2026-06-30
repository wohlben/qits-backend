package eu.wohlben.qits.domain.command.dto;

import eu.wohlben.qits.domain.command.entity.LogChannel;
import java.time.Instant;

/**
 * One line of a command's captured log.
 *
 * @param sequence the monotonic per-command ordinal (stable sort key)
 * @param channel which stream the line came from (STDIN vs merged OUTPUT)
 * @param content the raw line text (may contain ANSI escapes)
 * @param timestamp when the line completed
 */
public record CommandLogLineDto(
    long sequence, LogChannel channel, String content, Instant timestamp) {}
