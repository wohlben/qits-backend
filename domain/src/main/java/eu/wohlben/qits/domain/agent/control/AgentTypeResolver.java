package eu.wohlben.qits.domain.agent.control;

import eu.wohlben.qits.domain.setting.control.SettingsService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Resolves which coding-agent harness a launch (or a default-scoped surface) should use. This is
 * the <em>only</em> place harness precedence lives, so future hierarchy levels (project /
 * repository / persisted-per-workspace / per-user) slot in by extending this one method's inputs.
 *
 * <p>Current two-level chain, highest first: the explicit per-launch choice (the workspace-tab
 * "final decision") → the qits-wide {@code agent.default-type} setting → a hard-coded {@link
 * AgentType#CLAUDE} safety fallback.
 */
@ApplicationScoped
public class AgentTypeResolver {

  @Inject SettingsService settings;

  /**
   * @param explicit the per-launch choice, or {@code null} to fall through to the default.
   */
  public AgentType resolve(AgentType explicit) {
    if (explicit != null) {
      return explicit;
    }
    return settings
        .get(SettingsService.AGENT_DEFAULT_TYPE)
        .flatMap(AgentType::parse)
        .orElse(AgentType.CLAUDE);
  }
}
