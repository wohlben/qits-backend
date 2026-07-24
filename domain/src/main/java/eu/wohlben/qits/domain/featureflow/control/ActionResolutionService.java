package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Map;

/**
 * Resolves the code-based (global) actions a workspace can run. Since Part 5
 * (config-as-single-source-of-truth) the repo-scoped DB store is gone, so this is a plain global
 * lookup — config-declared actions resolve from the workspace's ConfigView at the workspace actions
 * endpoint instead.
 *
 * <p>Actions are plain shell scripts — their {@code executeScript} runs verbatim. Launching a
 * coding agent (e.g. Claude Code with an MCP server attached) is no longer modelled as an action
 * variant; it is a separate concern owned by {@code eu.wohlben.qits.domain.agent}.
 */
@ApplicationScoped
public class ActionResolutionService {

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  /** A resolved action flattened to just what running it needs. */
  public record ResolvedAction(
      String id,
      String name,
      String executeScript,
      boolean interactive,
      Map<String, String> environment) {}

  /**
   * Resolves {@code actionId} to run it in {@code repositoryId}. Every stored action is global now,
   * so the repository id no longer gates the lookup; it stays on the signature for its callers.
   * Throws {@link NotFoundException} if the id is unknown.
   */
  @Transactional
  public ResolvedAction resolveForRepository(String repositoryId, String actionId) {
    ActionConfiguration action =
        actionConfigurationRepository
            .findByIdOptional(actionId)
            .orElseThrow(() -> new NotFoundException("Action not found: " + actionId));
    return new ResolvedAction(
        action.id, action.name, action.executeScript, action.interactive, action.environment);
  }
}
