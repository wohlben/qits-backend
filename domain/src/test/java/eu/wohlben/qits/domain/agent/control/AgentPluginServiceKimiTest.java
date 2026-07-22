package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertThrows;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.setting.control.SettingsService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Verifies the plugin surface is disabled for Kimi Code. The plugin gate resolves the qits-wide DB
 * default now, so the test sets {@code agent.default-type=kimi} instead of a config profile.
 */
@QuarkusTest
public class AgentPluginServiceKimiTest {

  @Inject AgentPluginService pluginService;

  @Inject SettingsService settingsService;

  @BeforeEach
  void defaultToKimi() {
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "kimi");
  }

  @AfterEach
  void restoreDefault() {
    // The DB is shared across no-profile @QuarkusTests in this JVM; restore the seeded default so
    // the kimi override never leaks into other suites' resolver reads.
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "claude");
  }

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
