package eu.wohlben.qits.domain.daemon.entity;

/** How a {@link HealthCheck} probes the daemon, ordered by dependency weight. */
public enum HealthCheckKind {
  /** {@code curl} against the container's loopback; the HTTP status is matched. */
  HTTP,
  /** A bare connect via bash's {@code /dev/tcp} builtin — works with zero extra tooling. */
  TCP,
  /** An arbitrary in-container script; exit 0 = healthy. The escape hatch. */
  COMMAND
}
