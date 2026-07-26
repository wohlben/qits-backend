package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.error.BadRequestException;
import eu.wohlben.qits.domain.error.NotFoundException;
import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.entity.ActionConfiguration;
import eu.wohlben.qits.domain.repository.control.QitsConfig;
import eu.wohlben.qits.domain.repository.control.WorkspaceConfigView;
import eu.wohlben.qits.workspacedaemonhost.WorkspaceDaemonRegistry;
import jakarta.inject.Inject;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The workspace actions surface (Part 5, config-as-single-source-of-truth): the union of the
 * code-based global actions ({@code CODE}) and the workspace's config-declared actions ({@code
 * CONFIG}, read in-container over the control socket). A config action runs over the socket too —
 * the existing {@code RunCommand} verb ({@code bash -lc <execute>} in {@code /workspace}), awaited
 * with a bounded timeout; runs are deliberately <em>not</em> recorded as {@code Command} rows (no
 * run history/re-attach until the workspace-daemon MCP re-homes this). Interactive config actions
 * are listed but not runnable here (the pipe-mode {@code RunCommand} is non-interactive) — a POST
 * for one is a 400; no live daemon is a 409.
 */
@Path("/repositories/{repoId}/workspaces/{workspaceId}/actions")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class WorkspaceActionsController {

  @Inject ActionConfigurationService actionConfigurationService;

  @Inject WorkspaceDaemonRegistry daemonRegistry;

  /** Upper bound on awaiting one config-action run over the control socket. */
  @ConfigProperty(name = "qits.workspace-actions.run-timeout-ms", defaultValue = "600000")
  long runTimeoutMillis;

  /** Where an action comes from: the code-based global library, or the workspace's config file. */
  public enum ActionOrigin {
    CODE,
    CONFIG
  }

  public record WorkspaceActionDto(
      String id,
      String name,
      String description,
      ActionOrigin origin,
      boolean interactive,
      boolean runnable) {}

  public static record ListWorkspaceActionsRequest() {
    public record Response(List<WorkspaceActionDto> actions) {}
  }

  @GET
  public ListWorkspaceActionsRequest.Response list(
      @PathParam("repoId") String repoId, @PathParam("workspaceId") String workspaceId) {
    List<WorkspaceActionDto> actions = new ArrayList<>();
    for (ActionConfiguration global : actionConfigurationService.list()) {
      actions.add(
          new WorkspaceActionDto(
              global.id,
              global.name,
              global.description,
              ActionOrigin.CODE,
              global.interactive,
              true));
    }
    daemonRegistry
        .readConfig(workspaceId)
        .ifPresent(
            view ->
                view.config().actions().stream()
                    .map(
                        decl ->
                            new WorkspaceActionDto(
                                decl.id(),
                                decl.name(),
                                decl.description(),
                                ActionOrigin.CONFIG,
                                decl.interactive(),
                                !decl.interactive()))
                    .forEach(actions::add));
    return new ListWorkspaceActionsRequest.Response(actions);
  }

  public static record RunWorkspaceActionRequest() {
    public record Response(int exitCode, String stdout, String stderr) {}
  }

  /** {@code {actionId}} is the config-declared action {@code id:} (defaulting to its name). */
  @POST
  @Path("/{actionId}/run")
  public RunWorkspaceActionRequest.Response run(
      @PathParam("repoId") String repoId,
      @PathParam("workspaceId") String workspaceId,
      @PathParam("actionId") String actionId) {
    if (!daemonRegistry.isDaemonLive(workspaceId)) {
      throw new ClientErrorException(
          "No workspace-daemon is live for workspace " + workspaceId, 409);
    }
    WorkspaceConfigView view =
        daemonRegistry
            .readConfig(workspaceId)
            .orElseThrow(
                () -> new NotFoundException("No config readable for workspace " + workspaceId));
    QitsConfig.ActionDecl decl =
        view.config().actions().stream()
            .filter(a -> a.id().equals(actionId))
            .findFirst()
            .orElseThrow(
                () ->
                    new NotFoundException(
                        "Action not declared in the workspace qits config: " + actionId));
    if (decl.interactive()) {
      throw new BadRequestException(
          "Interactive actions run in a workspace terminal, not over the control socket: "
              + actionId);
    }
    WorkspaceDaemonRegistry.CommandResult result;
    try {
      result =
          daemonRegistry
              .runCommand(
                  workspaceId,
                  List.of("bash", "-lc", decl.execute()),
                  "/workspace",
                  decl.environment())
              .get(runTimeoutMillis, TimeUnit.MILLISECONDS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ClientErrorException("Action run interrupted", 500);
    } catch (java.util.concurrent.TimeoutException e) {
      throw new ClientErrorException(
          "Action run exceeded the " + runTimeoutMillis + " ms timeout", 504);
    } catch (java.util.concurrent.ExecutionException e) {
      throw new ClientErrorException("Action run failed: " + e.getCause().getMessage(), 500);
    }
    return new RunWorkspaceActionRequest.Response(
        result.exitCode(), result.stdout(), result.stderr());
  }
}
