package eu.wohlben.qits.domain.command.entity;

/** Lifecycle state of a launched command in the registry. */
public enum CommandStatus {
  /** The process is alive in the registry (a client may or may not be attached). */
  RUNNING,
  /** The process exited on its own; {@code exitCode} holds its status. */
  EXITED,
  /** The user explicitly terminated the process (SIGKILL via the registry). */
  TERMINATED,
  /**
   * The process was lost to a JVM restart: it was {@code RUNNING} in a previous run but its OS
   * process died with that JVM and is not in the live registry. Set by startup reconciliation.
   */
  INTERRUPTED
}
