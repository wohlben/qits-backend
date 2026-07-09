package eu.wohlben.qits.domain.daemon.api;

import eu.wohlben.qits.domain.daemon.control.RepositoryDaemonService;
import eu.wohlben.qits.domain.daemon.dto.RepositoryDaemonDto;
import eu.wohlben.qits.domain.daemon.entity.RestartPolicy;
import eu.wohlben.qits.domain.daemon.mapper.RepositoryDaemonMapper;
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

/** CRUD over one repository's own daemons (the REST twin of the repo-action MCP tools). */
@Path("/repositories/{repositoryId}/daemons")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RepositoryDaemonController {

  @Inject RepositoryDaemonService repositoryDaemonService;

  @Inject RepositoryDaemonMapper repositoryDaemonMapper;

  public static record CreateRepositoryDaemonRequest(
      @NotBlank String name,
      String description,
      @NotBlank String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Boolean autoStart,
      Integer maxRestarts,
      Boolean otel,
      @Valid WebViewInput webView,
      Map<String, String> environment,
      List<@Valid LogObserverInput> observers,
      List<@Valid LogSourceInput> sources) {
    public record Response(RepositoryDaemonDto daemon) {}
  }

  @POST
  public CreateRepositoryDaemonRequest.Response create(
      @PathParam("repositoryId") String repositoryId,
      @Valid CreateRepositoryDaemonRequest request) {
    WebViewInput webView = request.webView();
    var daemon =
        repositoryDaemonService.create(
            repositoryId,
            request.name(),
            request.description(),
            request.startScript(),
            request.readyPattern(),
            request.stopSignal(),
            request.restartPolicy(),
            request.autoStart(),
            request.maxRestarts(),
            request.otel(),
            webView != null ? webView.port() : null,
            webView != null ? webView.entryPath() : null,
            webView != null ? webView.basePath() : null,
            request.environment(),
            LogObserverInput.toEntities(request.observers()),
            LogSourceInput.toEntities(request.sources()));
    return new CreateRepositoryDaemonRequest.Response(repositoryDaemonMapper.toDto(daemon));
  }

  public static record GetRepositoryDaemonRequest() {
    public record Response(RepositoryDaemonDto daemon) {}
  }

  @GET
  @Path("/{daemonId}")
  public GetRepositoryDaemonRequest.Response get(
      @PathParam("repositoryId") String repositoryId, @PathParam("daemonId") String daemonId) {
    var daemon = repositoryDaemonService.get(repositoryId, daemonId);
    return new GetRepositoryDaemonRequest.Response(repositoryDaemonMapper.toDto(daemon));
  }

  public static record ListRepositoryDaemonsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(RepositoryDaemonDto daemon) {}
    }
  }

  @GET
  public ListRepositoryDaemonsRequest.Response list(
      @PathParam("repositoryId") String repositoryId) {
    var entries =
        repositoryDaemonService.list(repositoryId).stream()
            .map(
                d ->
                    new ListRepositoryDaemonsRequest.Response.Entry(
                        repositoryDaemonMapper.toDto(d)))
            .toList();
    return new ListRepositoryDaemonsRequest.Response(entries);
  }

  public static record UpdateRepositoryDaemonRequest(
      @NotBlankIfPresent String name,
      String description,
      @NotBlankIfPresent String startScript,
      String readyPattern,
      String stopSignal,
      RestartPolicy restartPolicy,
      Boolean autoStart,
      Integer maxRestarts,
      Boolean otel,
      @Valid WebViewInput webView,
      Map<String, String> environment,
      List<@Valid LogObserverInput> observers,
      List<@Valid LogSourceInput> sources) {
    public record Response(RepositoryDaemonDto daemon) {}
  }

  @PUT
  @Path("/{daemonId}")
  public UpdateRepositoryDaemonRequest.Response update(
      @PathParam("repositoryId") String repositoryId,
      @PathParam("daemonId") String daemonId,
      @Valid UpdateRepositoryDaemonRequest request) {
    // A present webView block replaces both paths wholesale (null path ⇒ sent as "" = clear) while
    // a null port carries the stored one over; an omitted block keeps the stored config.
    WebViewInput webView = request.webView();
    var daemon =
        repositoryDaemonService.update(
            repositoryId,
            daemonId,
            request.name(),
            request.description(),
            request.startScript(),
            request.readyPattern(),
            request.stopSignal(),
            request.restartPolicy(),
            request.autoStart(),
            request.maxRestarts(),
            request.otel(),
            webView != null ? webView.port() : null,
            webView != null ? webView.entryPathOrEmpty() : null,
            webView != null ? webView.basePathOrEmpty() : null,
            request.environment(),
            LogObserverInput.toEntities(request.observers()),
            LogSourceInput.toEntities(request.sources()));
    return new UpdateRepositoryDaemonRequest.Response(repositoryDaemonMapper.toDto(daemon));
  }

  public static record DeleteRepositoryDaemonRequest() {
    public record Response(boolean success) {}
  }

  @DELETE
  @Path("/{daemonId}")
  public DeleteRepositoryDaemonRequest.Response delete(
      @PathParam("repositoryId") String repositoryId, @PathParam("daemonId") String daemonId) {
    repositoryDaemonService.delete(repositoryId, daemonId);
    return new DeleteRepositoryDaemonRequest.Response(true);
  }
}
