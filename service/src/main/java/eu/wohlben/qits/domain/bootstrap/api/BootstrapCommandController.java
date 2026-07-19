package eu.wohlben.qits.domain.bootstrap.api;

import eu.wohlben.qits.domain.bootstrap.control.BootstrapCommandService;
import eu.wohlben.qits.domain.bootstrap.dto.BootstrapCommandDto;
import eu.wohlben.qits.domain.bootstrap.mapper.BootstrapCommandMapper;
import eu.wohlben.qits.validation.NotBlankIfPresent;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;

/**
 * CRUD over one repository's bootstrap chain (the daemon controller's sibling). The list is always
 * returned in execution order; {@code PUT /order} rewrites the whole ordering atomically.
 */
@Path("/repositories/{repositoryId}/bootstrap-commands")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class BootstrapCommandController {

  @Inject BootstrapCommandService bootstrapCommandService;

  @Inject BootstrapCommandMapper bootstrapCommandMapper;

  public static record CreateBootstrapCommandRequest(
      @NotBlank String name,
      String description,
      @NotBlank String executeScript,
      String checkScript,
      Map<String, String> environment,
      Integer orderIndex) {
    public record Response(BootstrapCommandDto command) {}
  }

  @POST
  public CreateBootstrapCommandRequest.Response create(
      @PathParam("repositoryId") String repositoryId,
      @Valid CreateBootstrapCommandRequest request) {
    var command =
        bootstrapCommandService.create(
            repositoryId,
            request.name(),
            request.description(),
            request.executeScript(),
            request.checkScript(),
            request.environment(),
            request.orderIndex());
    return new CreateBootstrapCommandRequest.Response(bootstrapCommandMapper.toDto(command));
  }

  public static record GetBootstrapCommandRequest() {
    public record Response(BootstrapCommandDto command) {}
  }

  @GET
  @Path("/{commandId}")
  public GetBootstrapCommandRequest.Response get(
      @PathParam("repositoryId") String repositoryId, @PathParam("commandId") String commandId) {
    var command = bootstrapCommandService.get(repositoryId, commandId);
    return new GetBootstrapCommandRequest.Response(bootstrapCommandMapper.toDto(command));
  }

  public static record ListBootstrapCommandsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(BootstrapCommandDto command) {}
    }
  }

  @GET
  public ListBootstrapCommandsRequest.Response list(
      @PathParam("repositoryId") String repositoryId) {
    var entries =
        bootstrapCommandService.list(repositoryId).stream()
            .map(
                c ->
                    new ListBootstrapCommandsRequest.Response.Entry(
                        bootstrapCommandMapper.toDto(c)))
            .toList();
    return new ListBootstrapCommandsRequest.Response(entries);
  }

  public static record UpdateBootstrapCommandRequest(
      @NotBlankIfPresent String name,
      String description,
      @NotBlankIfPresent String executeScript,
      String checkScript,
      Map<String, String> environment,
      Integer orderIndex) {
    public record Response(BootstrapCommandDto command) {}
  }

  @PUT
  @Path("/{commandId}")
  public UpdateBootstrapCommandRequest.Response update(
      @PathParam("repositoryId") String repositoryId,
      @PathParam("commandId") String commandId,
      @Valid UpdateBootstrapCommandRequest request) {
    var command =
        bootstrapCommandService.update(
            repositoryId,
            commandId,
            request.name(),
            request.description(),
            request.executeScript(),
            request.checkScript(),
            request.environment(),
            request.orderIndex());
    return new UpdateBootstrapCommandRequest.Response(bootstrapCommandMapper.toDto(command));
  }

  public static record DeleteBootstrapCommandRequest() {
    public record Response(boolean success) {}
  }

  @DELETE
  @Path("/{commandId}")
  public DeleteBootstrapCommandRequest.Response delete(
      @PathParam("repositoryId") String repositoryId, @PathParam("commandId") String commandId) {
    bootstrapCommandService.delete(repositoryId, commandId);
    return new DeleteBootstrapCommandRequest.Response(true);
  }

  public static record OrderBootstrapCommandsRequest(@NotEmpty List<String> ids) {
    public record Response(List<Entry> entries) {
      public record Entry(BootstrapCommandDto command) {}
    }
  }

  @PUT
  @Path("/order")
  public OrderBootstrapCommandsRequest.Response order(
      @PathParam("repositoryId") String repositoryId,
      @Valid OrderBootstrapCommandsRequest request) {
    var entries =
        bootstrapCommandService.reorder(repositoryId, request.ids()).stream()
            .map(
                c ->
                    new OrderBootstrapCommandsRequest.Response.Entry(
                        bootstrapCommandMapper.toDto(c)))
            .toList();
    return new OrderBootstrapCommandsRequest.Response(entries);
  }
}
