package eu.wohlben.qits.domain.agent.control;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import eu.wohlben.qits.domain.agent.dto.InstalledPluginDto;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * Pure tests for parsing {@code enabledPlugins} out of the shared volume's {@code settings.json}.
 */
public class AgentPluginServiceTest {

  private Map<String, Boolean> byId(List<InstalledPluginDto> plugins) {
    return plugins.stream()
        .collect(Collectors.toMap(InstalledPluginDto::pluginId, InstalledPluginDto::enabled));
  }

  @Test
  public void parsesEnabledAndDisabledPlugins() {
    String json =
        "{\"enabledPlugins\": {"
            + "\"jdtls-lsp@claude-plugins-official\": true,"
            + "\"typescript-lsp@claude-plugins-official\": false"
            + "}}";
    Map<String, Boolean> plugins = byId(AgentPluginService.parseEnabledPlugins(json));
    assertEquals(2, plugins.size());
    assertTrue(plugins.get("jdtls-lsp@claude-plugins-official"));
    assertEquals(Boolean.FALSE, plugins.get("typescript-lsp@claude-plugins-official"));
  }

  @Test
  public void anAbsentEnabledPluginsObjectIsEmpty() {
    // A settings.json with other keys but no plugins ever installed.
    assertEquals(List.of(), AgentPluginService.parseEnabledPlugins("{\"theme\": \"dark\"}"));
  }

  @Test
  public void aMissingOrBlankFileIsEmpty() {
    // cat of a non-existent settings.json returns empty output (exitCode handled by the caller).
    assertEquals(List.of(), AgentPluginService.parseEnabledPlugins(""));
    assertEquals(List.of(), AgentPluginService.parseEnabledPlugins(null));
  }

  @Test
  public void malformedJsonIsToleratedAsEmpty() {
    // The settings.json schema is undocumented — tolerate shape drift rather than 500.
    assertEquals(List.of(), AgentPluginService.parseEnabledPlugins("not json at all"));
    assertEquals(
        List.of(),
        AgentPluginService.parseEnabledPlugins("{\"enabledPlugins\": \"not-an-object\"}"));
  }
}
