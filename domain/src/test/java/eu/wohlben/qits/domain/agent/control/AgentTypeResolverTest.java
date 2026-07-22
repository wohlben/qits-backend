package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;

import eu.wohlben.qits.domain.setting.control.SettingsService;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The single seat of harness precedence: explicit → DB default → CLAUDE. */
@QuarkusTest
public class AgentTypeResolverTest {

  @Inject AgentTypeResolver resolver;

  @Inject SettingsService settingsService;

  @AfterEach
  void restoreDefault() {
    // Shared DB across no-profile @QuarkusTests — always return the seeded default.
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "claude");
  }

  @Test
  public void explicitChoiceWins() {
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "claude");
    assertEquals(AgentType.KIMI, resolver.resolve(AgentType.KIMI));
    assertEquals(AgentType.CLAUDE, resolver.resolve(AgentType.CLAUDE));
  }

  @Test
  public void fallsBackToTheDbDefaultWhenNoExplicitChoice() {
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "kimi");
    assertEquals(AgentType.KIMI, resolver.resolve(null));

    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "claude");
    assertEquals(AgentType.CLAUDE, resolver.resolve(null));
  }
}
