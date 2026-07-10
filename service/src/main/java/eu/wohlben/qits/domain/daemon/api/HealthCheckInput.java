package eu.wohlben.qits.domain.daemon.api;

import eu.wohlben.qits.domain.daemon.entity.HealthCheck;
import eu.wohlben.qits.domain.daemon.entity.HealthCheckKind;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * One healthcheck as submitted by clients. Only presence is bean-validated here — the per-kind
 * rules (port ranges, expectStatus tokens, field exclusivity) live in the domain validator, so REST
 * and MCP share them.
 */
public record HealthCheckInput(
    @NotBlank String name,
    @NotNull HealthCheckKind kind,
    Integer port,
    String path,
    String expectStatus,
    String command,
    Long intervalMs,
    Long timeoutMs,
    Integer healthyThreshold,
    Integer unhealthyThreshold,
    Long initialDelayMs) {

  public HealthCheck toEntity() {
    return new HealthCheck(
        name,
        kind,
        port,
        path,
        expectStatus,
        command,
        intervalMs,
        timeoutMs,
        healthyThreshold,
        unhealthyThreshold,
        initialDelayMs);
  }

  /** Null stays null (meaning "keep as-is" on update); a present list is converted wholesale. */
  public static List<HealthCheck> toEntities(List<HealthCheckInput> healthChecks) {
    return healthChecks == null
        ? null
        : healthChecks.stream().map(HealthCheckInput::toEntity).toList();
  }
}
