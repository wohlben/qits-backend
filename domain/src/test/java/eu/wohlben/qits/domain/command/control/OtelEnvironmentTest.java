package eu.wohlben.qits.domain.command.control;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Exact composition of the injected OTEL_* overlay against a pinned git-host + port. */
@QuarkusTest
@TestProfile(OtelEnvironmentTest.TestProfile.class)
public class OtelEnvironmentTest {

  public static class TestProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of(
          "qits.workspace.git-host", "203.0.113.7",
          "qits.workspace.qits-port", "8181");
    }
  }

  @Inject OtelEnvironment otelEnvironment;

  @Test
  public void composesEndpointProtocolServiceNameAndResourceAttributes() {
    Map<String, String> env =
        otelEnvironment.forLaunch("repo-uuid", "wt-1", "cmd-uuid", "my dev server");

    assertEquals("http://203.0.113.7:8181/api/otel", env.get("OTEL_EXPORTER_OTLP_ENDPOINT"));
    assertEquals("http/protobuf", env.get("OTEL_EXPORTER_OTLP_PROTOCOL"));
    assertEquals("my dev server", env.get("OTEL_SERVICE_NAME"));
    assertEquals(
        "qits.worktree.id=wt-1,qits.repository.id=repo-uuid,qits.command.id=cmd-uuid",
        env.get("OTEL_RESOURCE_ATTRIBUTES"));
    assertEquals(4, env.size(), "no stray variables");
  }
}
