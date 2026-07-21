package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertThrows;

import eu.wohlben.qits.domain.error.BadRequestException;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Verifies the plugin surface is disabled for Kimi Code. */
@QuarkusTest
@TestProfile(AgentPluginServiceKimiTest.KimiProfile.class)
public class AgentPluginServiceKimiTest {

  public static class KimiProfile implements QuarkusTestProfile {
    @Override
    public Map<String, String> getConfigOverrides() {
      return Map.of("qits.agent.type", "kimi");
    }
  }

  @Inject AgentPluginService pluginService;

  @Test
  public void listInstalledRejectsKimi() {
    assertThrows(
        BadRequestException.class,
        () -> pluginService.listInstalled("11111111-1111-1111-1111-111111111111", "work"));
  }

  @Test
  public void installRejectsKimi() {
    assertThrows(
        BadRequestException.class,
        () -> pluginService.install("11111111-1111-1111-1111-111111111111", "work", "jdtls-lsp"));
  }
}
