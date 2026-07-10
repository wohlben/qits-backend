package eu.wohlben.qits.domain.command.api;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import eu.wohlben.qits.domain.command.control.CommandService;
import eu.wohlben.qits.domain.command.dto.CommandDto;
import eu.wohlben.qits.domain.command.dto.CommandLogLineDto;
import eu.wohlben.qits.domain.command.entity.CommandStatus;
import eu.wohlben.qits.domain.command.entity.LogChannel;
import eu.wohlben.qits.domain.command.entity.LogSeverity;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/**
 * The registry-backed command API: launch a process into a workspace, list running/terminated
 * commands, inspect one, and terminate one. Launching returns the command immediately; an
 * interactive run is then watched by opening the terminal websocket on {@code command.id}.
 */
@Path("/commands")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CommandController {

  @Inject CommandService commandService;

  public static record LaunchCommandRequest(
      @NotBlank String repoId, @NotBlank String workspaceId, @NotBlank String actionId) {
    public record Response(CommandDto command) {}
  }

  @POST
  public LaunchCommandRequest.Response launch(@Valid LaunchCommandRequest request) {
    return new LaunchCommandRequest.Response(
        commandService.launch(request.repoId(), request.workspaceId(), request.actionId()));
  }

  public static record ListCommandsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(CommandDto command) {}
    }
  }

  @GET
  public ListCommandsRequest.Response list(
      @QueryParam("repoId") String repoId,
      @QueryParam("workspaceId") String workspaceId,
      @QueryParam("status") CommandStatus status) {
    var entries =
        commandService.list(repoId, workspaceId, status).stream()
            .map(ListCommandsRequest.Response.Entry::new)
            .toList();
    return new ListCommandsRequest.Response(entries);
  }

  public static record GetCommandRequest() {
    public record Response(CommandDto command) {}
  }

  @GET
  @Path("/{commandId}")
  public GetCommandRequest.Response get(@PathParam("commandId") String commandId) {
    return new GetCommandRequest.Response(commandService.get(commandId));
  }

  public static record GetCommandLogRequest() {
    public record Response(List<CommandLogLineDto> lines) {}
  }

  @GET
  @Path("/{commandId}/log")
  public GetCommandLogRequest.Response log(
      @PathParam("commandId") String commandId,
      @QueryParam("severity") LogSeverity severity,
      @QueryParam("channel") LogChannel channel) {
    return new GetCommandLogRequest.Response(commandService.log(commandId, severity, channel));
  }

  /**
   * The SessionStart hook's report body — the hook's stdin JSON forwarded verbatim from inside the
   * workspace container, hence the snake_case fields and the tolerance for extras.
   */
  @JsonIgnoreProperties(ignoreUnknown = true)
  public static record ReportAgentSessionRequest(
      @JsonProperty("hook_event_name") String hookEventName,
      @JsonProperty("source") String source,
      @JsonProperty("session_id") String sessionId,
      @JsonProperty("transcript_path") String transcriptPath) {
    public record Response(CommandDto command) {}
  }

  /**
   * Ingests a harness session report for a running command: the first report confirms the pinned
   * session (recording the authoritative transcript path); a report with a different session id —
   * the user switched sessions inside the interactive TUI — appends a {@code SWITCHED} entry to the
   * command's session list. Reached from inside the container (like the git host and the MCP
   * servers), so the id is validated and the command must exist and be running.
   */
  @POST
  @Path("/{commandId}/agent-session")
  public ReportAgentSessionRequest.Response reportAgentSession(
      @PathParam("commandId") String commandId, @Valid ReportAgentSessionRequest request) {
    return new ReportAgentSessionRequest.Response(
        commandService.reportAgentSession(
            commandId, request.sessionId(), request.transcriptPath()));
  }

  public static record TerminateCommandRequest() {
    public record Response(CommandDto command) {}
  }

  @POST
  @Path("/{commandId}/terminate")
  public TerminateCommandRequest.Response terminate(@PathParam("commandId") String commandId) {
    return new TerminateCommandRequest.Response(commandService.terminate(commandId));
  }
}
