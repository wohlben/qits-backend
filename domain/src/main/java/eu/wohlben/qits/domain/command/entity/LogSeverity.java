package eu.wohlben.qits.domain.command.entity;

/**
 * Per-line severity stamped on captured log lines at persist time (DAEMON commands' OUTPUT lines,
 * classified locally). Null on unclassified lines — routine output deliberately carries no
 * severity. Lives in the command area (not daemon) so the audit log doesn't depend on the daemon
 * package; the daemon area provides the classifier implementation via CDI.
 */
public enum LogSeverity {
  INFO,
  WARNING,
  ERROR
}
