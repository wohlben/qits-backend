package eu.wohlben.qits.domain.action.api;

import eu.wohlben.qits.domain.action.control.ActionConfigurationService;
import eu.wohlben.qits.domain.action.entity.ActionConfiguration;
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

@Path("/action-configurations")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ActionConfigurationController {

    @Inject
    ActionConfigurationService actionConfigurationService;

    public static record CreateActionConfigurationRequest(
        @NotBlank String id,
        @NotBlank String name,
        String description,
        @NotBlank String executeScript,
        @NotBlank String checkScript
    ) {
        public record Response(String id, String name, String description, String executeScript, String checkScript) {}
    }

    @POST
    public CreateActionConfigurationRequest.Response create(@Valid CreateActionConfigurationRequest request) {
        var config = actionConfigurationService.create(
            request.id(), request.name(), request.description(), request.executeScript(), request.checkScript()
        );
        return toResponse(config);
    }

    public static record GetActionConfigurationRequest() {
        public record Response(String id, String name, String description, String executeScript, String checkScript) {}
    }

    @GET
    @Path("/{id}")
    public GetActionConfigurationRequest.Response get(@PathParam("id") String id) {
        var config = actionConfigurationService.get(id);
        return toGetResponse(config);
    }

    public static record ListActionConfigurationsRequest() {
        public record Response(List<Entry> entries) {
            public record Entry(String id, String name, String description) {}
        }
    }

    @GET
    public ListActionConfigurationsRequest.Response list() {
        var configs = actionConfigurationService.list();
        var entries = configs.stream()
            .map(c -> new ListActionConfigurationsRequest.Response.Entry(c.id, c.name, c.description))
            .toList();
        return new ListActionConfigurationsRequest.Response(entries);
    }

    public static record UpdateActionConfigurationRequest(
        String name,
        String description,
        String executeScript,
        String checkScript
    ) {
        public record Response(String id, String name, String description, String executeScript, String checkScript) {}
    }

    @PUT
    @Path("/{id}")
    public UpdateActionConfigurationRequest.Response update(@PathParam("id") String id, @Valid UpdateActionConfigurationRequest request) {
        var config = actionConfigurationService.update(
            id, request.name(), request.description(), request.executeScript(), request.checkScript()
        );
        return toUpdateResponse(config);
    }

    public static record DeleteActionConfigurationRequest() {
        public record Response(boolean success) {}
    }

    @DELETE
    @Path("/{id}")
    public DeleteActionConfigurationRequest.Response delete(@PathParam("id") String id) {
        actionConfigurationService.delete(id);
        return new DeleteActionConfigurationRequest.Response(true);
    }

    private static CreateActionConfigurationRequest.Response toResponse(ActionConfiguration config) {
        return new CreateActionConfigurationRequest.Response(
            config.id, config.name, config.description, config.executeScript, config.checkScript
        );
    }

    private static GetActionConfigurationRequest.Response toGetResponse(ActionConfiguration config) {
        return new GetActionConfigurationRequest.Response(
            config.id, config.name, config.description, config.executeScript, config.checkScript
        );
    }

    private static UpdateActionConfigurationRequest.Response toUpdateResponse(ActionConfiguration config) {
        return new UpdateActionConfigurationRequest.Response(
            config.id, config.name, config.description, config.executeScript, config.checkScript
        );
    }
}
