package eu.wohlben.qits.domain.setting.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.error.BadRequestException;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

@QuarkusTest
public class SettingsServiceTest {

  @Inject SettingsService settingsService;

  @Test
  public void upsertThenGet() {
    String key = "test.upsert-then-get";
    settingsService.set(key, "one");
    assertEquals("one", settingsService.get(key).orElseThrow());

    // A second set on the same key overwrites, it does not insert a duplicate.
    settingsService.set(key, "two");
    assertEquals("two", settingsService.get(key).orElseThrow());
    assertEquals(1, settingsService.list().stream().filter(s -> s.key.equals(key)).count());
  }

  @Test
  public void getOrDefaultReturnsFallbackWhenUnset() {
    assertEquals("fallback", settingsService.getOrDefault("test.never-set", "fallback"));
    assertTrue(settingsService.get("test.never-set").isEmpty());
  }

  @Test
  public void listIncludesTheSeededDefaultAgentSetting() {
    assertTrue(
        settingsService.list().stream()
            .anyMatch(s -> s.key.equals(SettingsService.AGENT_DEFAULT_TYPE)),
        "the V40 migration seeds agent.default-type");
  }

  @Test
  public void unknownAgentDefaultTypeIsRejected() {
    assertThrows(
        BadRequestException.class,
        () -> settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "gpt"));
    assertThrows(
        BadRequestException.class,
        () -> settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, ""));
  }

  @Test
  public void agentDefaultTypeIsStoredCanonicallyRegardlessOfInputCase() {
    // A lowercase input is accepted and stored as the canonical AgentType name, so value consumers
    // (the Settings select) match it without case handling.
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "kimi");
    assertEquals("KIMI", settingsService.get(SettingsService.AGENT_DEFAULT_TYPE).orElseThrow());
    // Restore the seeded default so the shared DB never leaks into other suites' resolver reads.
    settingsService.set(SettingsService.AGENT_DEFAULT_TYPE, "claude");
    assertEquals("CLAUDE", settingsService.get(SettingsService.AGENT_DEFAULT_TYPE).orElseThrow());
  }

  @Test
  public void blankKeyIsRejected() {
    assertThrows(BadRequestException.class, () -> settingsService.set("  ", "x"));
    assertFalse(settingsService.get("  ").isPresent());
  }
}
