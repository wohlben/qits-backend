package eu.wohlben.qits.domain.featureflow.mcp;

import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.control.ActionResolutionService;
import eu.wohlben.qits.domain.featureflow.control.RepositoryActionService;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.mapper.ActionConfigurationMapper;
import eu.wohlben.qits.domain.featureflow.mapper.RepositoryActionMapper;
import io.quarkiverse.mcp.server.McpServer;
import io.quarkiverse.mcp.server.Tool;
import io.quarkiverse.mcp.server.ToolArg;
import io.quarkiverse.mcp.server.WrapBusinessError;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Map;

/**
 * The "actions" MCP server — the management surface for actions, exposed to an LLM. An action is a
 * preconfigured process a worktree can run: an interactive one (a shell, Claude Code, launched by a
 * human in the terminal) or a non-interactive one-off command (e.g. {@code mvn test}).
 *
 * <p><strong>Use case: configuring actions, and only that.</strong> Connect here to define,
 * inspect, edit and delete what actions exist — not to use them. Executing a non-interactive action
 * is a working-context concern and lives on the repository server as {@code runAction} (see {@link
 * eu.wohlben.qits.domain.repository.mcp.RepositoryMcpTools}), which consumes what is managed here.
 *
 * <p><strong>Two scopes.</strong> The server runs <em>unscoped</em> by default and manages the
 * <em>global</em> library (the {@code *GlobalAction} tools — available in every repository). When a
 * connection sends an {@code X-QITS-Repository} header (see {@link RepositoryScope}) it
 * additionally manages that one repository's actions (the {@code *RepositoryAction} tools), which
 * {@link RepositoryActionToolFilter} only exposes while the header is present. {@code
 * listRepositoryActions} returns the repository's <em>effective</em> set — its own actions plus the
 * global ones it inherits — each tagged with its {@code scope}.
 *
 * <p>{@link WrapBusinessError} turns the domain {@code NotFoundException}/{@code
 * BadRequestException}s the services throw (a missing id, a blank name, an action in another
 * repository) into a readable tool error instead of a hard protocol failure.
 */
@ApplicationScoped
@WrapBusinessError
public class ActionConfigurationMcpTools {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject RepositoryActionService repositoryActionService;

  @Inject ActionResolutionService actionResolutionService;

  @Inject ActionConfigurationMapper actionConfigurationMapper;

  @Inject RepositoryActionMapper repositoryActionMapper;

  @Inject RepositoryScope repositoryScope;

  /** Result of deleting an action. */
  public record DeletedAction(String id, boolean deleted) {}

  // --- Global actions (always available) ------------------------------------

  @McpServer("actions")
  @Tool(
      description =
          "List every global action — the actions available in every repository, each with its"
              + " script, environment and whether it is interactive or a one-off command.")
  @Transactional
  public List<ActionConfigurationDto> listGlobalActions() {
    return actionConfigurationService.list().stream()
        .map(actionConfigurationMapper::toDto)
        .toList();
  }

  @McpServer("actions")
  @Tool(description = "Get one global action by id.")
  @Transactional
  public ActionConfigurationDto getGlobalAction(
      @ToolArg(description = "id of the global action") String id) {
    return actionConfigurationMapper.toDto(actionConfigurationService.get(id));
  }

  @McpServer("actions")
  @Tool(
      description =
          "Create a global action (available in every repository). 'executeScript' is the shell"
              + " command run in the worktree (required). Set 'interactive' true for a process meant"
              + " for the human terminal, false for a one-off command. 'checkScript' and"
              + " 'environment' are optional.")
  @Transactional
  public ActionConfigurationDto createGlobalAction(
      @ToolArg(description = "display name") String name,
      @ToolArg(required = false, description = "human description") String description,
      @ToolArg(description = "shell command to run in the worktree") String executeScript,
      @ToolArg(required = false, description = "optional probe script") String checkScript,
      @ToolArg(required = false, description = "runs in a worktree terminal (default false)")
          Boolean interactive,
      @ToolArg(required = false, description = "environment variables, as key/value pairs")
          Map<String, String> environment) {
    var config =
        actionConfigurationService.create(
            name,
            description,
            executeScript,
            checkScript,
            interactive != null && interactive,
            environment);
    return actionConfigurationMapper.toDto(config);
  }

  @McpServer("actions")
  @Tool(
      description =
          "Edit a global action. Only the fields you pass change; omit a field to keep it. An empty"
              + " 'checkScript' clears it. 'environment', when given, replaces the whole map.")
  @Transactional
  public ActionConfigurationDto updateGlobalAction(
      @ToolArg(description = "id of the global action to edit") String id,
      @ToolArg(required = false, description = "new name") String name,
      @ToolArg(required = false, description = "new description") String description,
      @ToolArg(required = false, description = "new shell command") String executeScript,
      @ToolArg(required = false, description = "new probe script ('' clears it)")
          String checkScript,
      @ToolArg(required = false, description = "new interactive flag") Boolean interactive,
      @ToolArg(required = false, description = "replacement environment, as key/value pairs")
          Map<String, String> environment) {
    var config =
        actionConfigurationService.update(
            id, name, description, executeScript, checkScript, interactive, environment);
    return actionConfigurationMapper.toDto(config);
  }

  @McpServer("actions")
  @Tool(description = "Delete a global action by id. Errors if no global action has that id.")
  @Transactional
  public DeletedAction deleteGlobalAction(
      @ToolArg(description = "id of the global action to delete") String id) {
    actionConfigurationService.delete(id);
    return new DeletedAction(id, true);
  }

  // --- Repository actions (only when X-QITS-Repository is set) ---------------

  @McpServer("actions")
  @Tool(
      description =
          "List the actions available in the scoped repository: its own repository actions plus the"
              + " global ones it inherits, each tagged with its scope. Requires the"
              + " X-QITS-Repository header.")
  @Transactional
  public List<ActionConfigurationDto> listRepositoryActions() {
    return actionResolutionService.effectiveActions(repositoryScope.requireRepositoryId());
  }

  @McpServer("actions")
  @Tool(
      description =
          "Get one of the scoped repository's own actions by id. Requires the X-QITS-Repository"
              + " header.")
  @Transactional
  public ActionConfigurationDto getRepositoryAction(
      @ToolArg(description = "id of the repository action") String id) {
    return repositoryActionMapper.toDto(
        repositoryActionService.get(repositoryScope.requireRepositoryId(), id));
  }

  @McpServer("actions")
  @Tool(
      description =
          "Create an action owned by the scoped repository (available only there). Same fields as a"
              + " global action; the owning repository comes from the X-QITS-Repository header, not"
              + " an argument.")
  @Transactional
  public ActionConfigurationDto createRepositoryAction(
      @ToolArg(description = "display name") String name,
      @ToolArg(required = false, description = "human description") String description,
      @ToolArg(description = "shell command to run in the worktree") String executeScript,
      @ToolArg(required = false, description = "optional probe script") String checkScript,
      @ToolArg(required = false, description = "runs in a worktree terminal (default false)")
          Boolean interactive,
      @ToolArg(required = false, description = "environment variables, as key/value pairs")
          Map<String, String> environment) {
    var action =
        repositoryActionService.create(
            repositoryScope.requireRepositoryId(),
            name,
            description,
            executeScript,
            checkScript,
            interactive != null && interactive,
            environment);
    return repositoryActionMapper.toDto(action);
  }

  @McpServer("actions")
  @Tool(
      description =
          "Edit one of the scoped repository's own actions. Only the fields you pass change; an empty"
              + " 'checkScript' clears it; 'environment' replaces the whole map. Requires the"
              + " X-QITS-Repository header.")
  @Transactional
  public ActionConfigurationDto updateRepositoryAction(
      @ToolArg(description = "id of the repository action to edit") String id,
      @ToolArg(required = false, description = "new name") String name,
      @ToolArg(required = false, description = "new description") String description,
      @ToolArg(required = false, description = "new shell command") String executeScript,
      @ToolArg(required = false, description = "new probe script ('' clears it)")
          String checkScript,
      @ToolArg(required = false, description = "new interactive flag") Boolean interactive,
      @ToolArg(required = false, description = "replacement environment, as key/value pairs")
          Map<String, String> environment) {
    var action =
        repositoryActionService.update(
            repositoryScope.requireRepositoryId(),
            id,
            name,
            description,
            executeScript,
            checkScript,
            interactive,
            environment);
    return repositoryActionMapper.toDto(action);
  }

  @McpServer("actions")
  @Tool(
      description =
          "Delete one of the scoped repository's own actions by id. Requires the X-QITS-Repository"
              + " header.")
  @Transactional
  public DeletedAction deleteRepositoryAction(
      @ToolArg(description = "id of the repository action to delete") String id) {
    repositoryActionService.delete(repositoryScope.requireRepositoryId(), id);
    return new DeletedAction(id, true);
  }
}
