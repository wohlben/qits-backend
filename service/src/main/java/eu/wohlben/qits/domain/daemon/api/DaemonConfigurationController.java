package eu.wohlben.qits.domain.daemon.api;

import eu.wohlben.qits.domain.daemon.control.DaemonConfigurationService;
import eu.wohlben.qits.domain.daemon.dto.DaemonConfigurationDto;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.mapper.DaemonConfigurationMapper;
import eu.wohlben.qits.validation.NotBlankIfPresent;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
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

/** CRUD over the global daemon library — the daemon twin of ActionConfigurationController. */
@Path("/daemon-configurations")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class DaemonConfigurationController {

  @Inject DaemonConfigurationService daemonConfigurationService;

  @Inject DaemonConfigurationMapper daemonConfigurationMapper;

  public static record CreateDaemonConfigurationRequest(
      @NotBlank String name,
      String description,
      @NotBlank String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Integer maxRestarts,
      Map<String, String> environment,
      List<@Valid LogObserverInput> observers,
      List<@Valid LogSourceInput> sources) {
    public record Response(DaemonConfigurationDto daemonConfiguration) {}
  }

  @POST
  public CreateDaemonConfigurationRequest.Response create(
      @Valid CreateDaemonConfigurationRequest request) {
    var config =
        daemonConfigurationService.create(
            request.name(),
            request.description(),
            request.startScript(),
            request.readyPattern(),
            request.stopSignal(),
            request.restartPolicy(),
            request.maxRestarts(),
            request.environment(),
            LogObserverInput.toEntities(request.observers()),
            LogSourceInput.toEntities(request.sources()));
    return new CreateDaemonConfigurationRequest.Response(daemonConfigurationMapper.toDto(config));
  }

  public static record GetDaemonConfigurationRequest() {
    public record Response(DaemonConfigurationDto daemonConfiguration) {}
  }

  @GET
  @Path("/{id}")
  public GetDaemonConfigurationRequest.Response get(@PathParam("id") String id) {
    var config = daemonConfigurationService.get(id);
    return new GetDaemonConfigurationRequest.Response(daemonConfigurationMapper.toDto(config));
  }

  public static record ListDaemonConfigurationsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(DaemonConfigurationDto daemonConfiguration) {}
    }
  }

  @GET
  public ListDaemonConfigurationsRequest.Response list() {
    var entries =
        daemonConfigurationService.list().stream()
            .map(
                c ->
                    new ListDaemonConfigurationsRequest.Response.Entry(
                        daemonConfigurationMapper.toDto(c)))
            .toList();
    return new ListDaemonConfigurationsRequest.Response(entries);
  }

  public static record UpdateDaemonConfigurationRequest(
      @NotBlankIfPresent String name,
      String description,
      @NotBlankIfPresent String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Integer maxRestarts,
      Map<String, String> environment,
      List<@Valid LogObserverInput> observers,
      List<@Valid LogSourceInput> sources) {
    public record Response(DaemonConfigurationDto daemonConfiguration) {}
  }

  @PUT
  @Path("/{id}")
  public UpdateDaemonConfigurationRequest.Response update(
      @PathParam("id") String id, @Valid UpdateDaemonConfigurationRequest request) {
    var config =
        daemonConfigurationService.update(
            id,
            request.name(),
            request.description(),
            request.startScript(),
            request.readyPattern(),
            request.stopSignal(),
            request.restartPolicy(),
            request.maxRestarts(),
            request.environment(),
            LogObserverInput.toEntities(request.observers()),
            LogSourceInput.toEntities(request.sources()));
    return new UpdateDaemonConfigurationRequest.Response(daemonConfigurationMapper.toDto(config));
  }

  public static record DeleteDaemonConfigurationRequest() {
    public record Response(boolean success) {}
  }

  @DELETE
  @Path("/{id}")
  public DeleteDaemonConfigurationRequest.Response delete(@PathParam("id") String id) {
    daemonConfigurationService.delete(id);
    return new DeleteDaemonConfigurationRequest.Response(true);
  }
}
