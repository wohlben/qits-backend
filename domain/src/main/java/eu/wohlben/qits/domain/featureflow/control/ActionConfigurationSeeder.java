package eu.wohlben.qits.domain.featureflow.control;

import eu.wohlben.qits.domain.featureflow.entity.ActionVariant;
import eu.wohlben.qits.domain.featureflow.persistence.ActionConfigurationRepository;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Map;
import org.jboss.logging.Logger;

/**
 * Seeds the default "run" actions that the worktree terminal offers out of the box, so a fresh
 * install always has at least an interactive shell to run. Idempotent (keyed by name), runs at
 * startup for whichever app (service or cli) boots.
 *
 * <p>These are ordinary {@link eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration}s with
 * no check script — the same entity feature flows reuse — so the Run… dialog and the feature-flow
 * action library share one concept.
 */
@ApplicationScoped
public class ActionConfigurationSeeder {

  private static final Logger LOG = Logger.getLogger(ActionConfigurationSeeder.class);

  @Inject ActionConfigurationRepository actionConfigurationRepository;

  @Inject ActionConfigurationService actionConfigurationService;

  void onStart(@Observes StartupEvent event) {
    seedDefaults();
  }

  @Transactional
  public void seedDefaults() {
    ensure(
        "Bash",
        "Interactive login shell in the worktree",
        "exec bash",
        ActionVariant.SHELL,
        Map.of());
    ensure(
        "Claude Code",
        "Launch Claude Code directly in the worktree",
        "exec claude",
        ActionVariant.SHELL,
        Map.of());
    ensure(
        "Claude Code (actions MCP)",
        "Claude Code with the actions MCP server attached, scoped to this repository — for managing"
            + " the repository's actions",
        "exec claude",
        ActionVariant.CLAUDE_ACTIONS_MCP,
        Map.of());
    ensure(
        "Claude Code (repository MCP)",
        "Claude Code with the repository MCP server attached, narrowed to this one repository — for"
            + " driving its branches, worktrees, commits and actions from within a subtree",
        "exec claude",
        ActionVariant.CLAUDE_REPOSITORY_MCP,
        Map.of());
    ensure(
        "Claude Code (project MCP)",
        "Claude Code with the repository MCP server attached, scoped to the whole project — for"
            + " driving every repository in the project",
        "exec claude",
        ActionVariant.CLAUDE_PROJECT_MCP,
        Map.of());
  }

  private void ensure(
      String name,
      String description,
      String executeScript,
      ActionVariant variant,
      Map<String, String> environment) {
    if (actionConfigurationRepository.findByName(name).isPresent()) {
      return;
    }
    // The seeded defaults are interactive terminal processes (a shell, Claude Code).
    actionConfigurationService.create(
        name, description, executeScript, null, true, variant, environment);
    LOG.infof("Seeded default run action '%s'.", name);
  }
}
