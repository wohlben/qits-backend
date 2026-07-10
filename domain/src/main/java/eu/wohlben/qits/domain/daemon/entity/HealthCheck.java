package eu.wohlben.qits.domain.daemon.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

/**
 * One healthcheck attached to a daemon definition: a named probe (HTTP/TCP/COMMAND) the supervisor
 * runs on an interval <em>inside the workspace container</em>, so {@code 127.0.0.1:<port>} is the
 * daemon's own loopback and no port publishing is needed. Stored as an element collection like
 * {@code observers}/{@code sources}. Results are runtime-only — cached latest-per-check in the
 * supervisor, never persisted.
 */
@Embeddable
public class HealthCheck {

  /** Human label shown on the status dot (e.g. {@code Quarkus}); unique within the daemon. */
  @Column(nullable = false)
  public String name;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  public HealthCheckKind kind;

  /** Container-loopback port probed by HTTP/TCP checks. Unused for COMMAND. */
  public Integer port;

  /** HTTP path (HTTP only); null means {@code /}. */
  @Column(length = 500)
  public String path;

  /**
   * Acceptable HTTP status tokens, comma-separated — {@code NNN} exact or {@code Nxx} class (HTTP
   * only); null means {@code 2xx,3xx}.
   */
  @Column(name = "expect_status", length = 100)
  public String expectStatus;

  /** Script run in the container (COMMAND only); exit 0 = healthy. */
  @Column(length = 4000)
  public String command;

  /** Poll cadence; null falls back to {@code qits.daemons.health-poll-ms}. */
  @Column(name = "interval_ms")
  public Long intervalMs;

  /** Per-probe timeout before the tick counts as a failure; null falls back to config. */
  @Column(name = "timeout_ms")
  public Long timeoutMs;

  /** Consecutive successes before flipping HEALTHY; null means 1. */
  @Column(name = "healthy_threshold")
  public Integer healthyThreshold;

  /** Consecutive failures before flipping UNHEALTHY (debounces flapping); null means 3. */
  @Column(name = "unhealthy_threshold")
  public Integer unhealthyThreshold;

  /**
   * Grace before the first probe so boot-time refusals aren't counted; null falls back to the
   * daemon ready grace.
   */
  @Column(name = "initial_delay_ms")
  public Long initialDelayMs;

  public HealthCheck() {}

  public HealthCheck(
      String name,
      HealthCheckKind kind,
      Integer port,
      String path,
      String expectStatus,
      String command,
      Long intervalMs,
      Long timeoutMs,
      Integer healthyThreshold,
      Integer unhealthyThreshold,
      Long initialDelayMs) {
    this.name = name;
    this.kind = kind;
    this.port = port;
    this.path = path;
    this.expectStatus = expectStatus;
    this.command = command;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.healthyThreshold = healthyThreshold;
    this.unhealthyThreshold = unhealthyThreshold;
    this.initialDelayMs = initialDelayMs;
  }
}
