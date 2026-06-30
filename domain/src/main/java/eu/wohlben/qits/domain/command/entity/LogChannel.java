package eu.wohlben.qits.domain.command.entity;

/**
 * Which stream a captured log line came from. A PTY merges a process's stdout and stderr into one
 * stream, so {@link #OUTPUT} covers both; {@link #STDIN} is what the human typed. {@link #STDERR}
 * is reserved for a possible future pipe-based (non-PTY) capture mode and is unused today.
 */
public enum LogChannel {
  STDIN,
  OUTPUT,
  STDERR
}
