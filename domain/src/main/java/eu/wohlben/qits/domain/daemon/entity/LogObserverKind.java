package eu.wohlben.qits.domain.daemon.entity;

/** How a log observer decides that a batch of daemon output is worth an event. */
public enum LogObserverKind {
  /** A regex matched against each output line; a match emits an event with the line. */
  PATTERN,
  /** A cheap model classifies pre-filtered output batches into error events. */
  MODEL
}
