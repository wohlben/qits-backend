package eu.wohlben.qits.domain.command.control;

import eu.wohlben.qits.domain.repository.control.GitHostResolver;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.LinkedHashMap;
import java.util.Map;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Composes the {@code OTEL_*} environment a launch gets when its definition has the {@code otel}
 * toggle: the exporter endpoint pointing at qits' in-process OTLP receiver, the protocol pinned to
 * {@code http/protobuf} (the receiver is protobuf-only; this normalizes SDKs that still default to
 * gRPC), and the {@code qits.*} resource attributes that let the telemetry store bucket everything
 * by worktree — the correlation backbone of the observability feature.
 *
 * <p>The endpoint host is composed exactly like {@code WorktreeService}'s git URL: the process runs
 * inside a workspace container, so {@code localhost} would miss — {@link GitHostResolver} picks the
 * container-reachable address per environment. SDKs append {@code /v1/<signal>} to the endpoint
 * themselves, including its {@code /api/otel} path prefix.
 */
@ApplicationScoped
public class OtelEnvironment {

  @Inject GitHostResolver gitHostResolver;

  @ConfigProperty(name = "qits.workspace.qits-port", defaultValue = "8080")
  int qitsPort;

  /**
   * The env overlay for a launch of {@code serviceName} in {@code worktreeId} of {@code repoId},
   * running as registry command {@code commandId}. All ids are UUIDs/slugs, so the comma/equals
   * syntax of {@code OTEL_RESOURCE_ATTRIBUTES} needs no escaping.
   */
  public Map<String, String> forLaunch(
      String repoId, String worktreeId, String commandId, String serviceName) {
    Map<String, String> env = new LinkedHashMap<>();
    env.put(
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "http://" + gitHostResolver.gitHost() + ":" + qitsPort + "/api/otel");
    env.put("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf");
    env.put("OTEL_SERVICE_NAME", serviceName);
    env.put(
        "OTEL_RESOURCE_ATTRIBUTES",
        "qits.worktree.id="
            + worktreeId
            + ",qits.repository.id="
            + repoId
            + ",qits.command.id="
            + commandId);
    return env;
  }
}
