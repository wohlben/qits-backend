package eu.wohlben.qits.domain.daemon.entity;

/** How a log observer decides that a batch of daemon output is worth an event. */
public enum LogObserverKind {
  /** A regex matched against each output line; a match emits an event with the line. */
  PATTERN,
  /**
   * Local classification off the severity vocabulary logs already carry (ERROR/WARN tokens,
   * exception class names, stack-trace openers) — batched, no configuration needed.
   */
  LOG_LEVEL
}
