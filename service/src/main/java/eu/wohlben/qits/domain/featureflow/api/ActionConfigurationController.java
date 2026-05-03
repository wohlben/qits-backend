package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.ActionConfigurationService;
import eu.wohlben.qits.domain.featureflow.dto.ActionConfigurationDto;
import eu.wohlben.qits.domain.featureflow.mapper.ActionConfigurationMapper;
import jakarta.inject.Inject;
import eu.wohlben.qits.validation.NotBlankIfPresent;
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

    @Inject
    ActionConfigurationMapper actionConfigurationMapper;

    public static record CreateActionConfigurationRequest(
        @NotBlank String name,
        String description,
        @NotBlank String executeScript,
        @NotBlank String checkScript
    ) {
        public record Response(ActionConfigurationDto actionConfiguration) {}
    }

    @POST
    public CreateActionConfigurationRequest.Response create(@Valid CreateActionConfigurationRequest request) {
        var config = actionConfigurationService.create(
            request.name(), request.description(), request.executeScript(), request.checkScript()
        );
        return new CreateActionConfigurationRequest.Response(
            actionConfigurationMapper.toDto(config)
        );
    }

    public static record GetActionConfigurationRequest() {
        public record Response(ActionConfigurationDto actionConfiguration) {}
    }

    @GET
    @Path("/{id}")
    public GetActionConfigurationRequest.Response get(@PathParam("id") String id) {
        var config = actionConfigurationService.get(id);
        return new GetActionConfigurationRequest.Response(
            actionConfigurationMapper.toDto(config)
        );
    }

    public static record ListActionConfigurationsRequest() {
        public record Response(List<Entry> entries) {
            public record Entry(ActionConfigurationDto actionConfiguration) {}
        }
    }

    @GET
    public ListActionConfigurationsRequest.Response list() {
        var configs = actionConfigurationService.list();
        var entries = configs.stream()
            .map(c -> new ListActionConfigurationsRequest.Response.Entry(
                actionConfigurationMapper.toDto(c)
            ))
            .toList();
        return new ListActionConfigurationsRequest.Response(entries);
    }

    public static record UpdateActionConfigurationRequest(
        @NotBlankIfPresent String name,
        String description,
        @NotBlankIfPresent String executeScript,
        @NotBlankIfPresent String checkScript
    ) {
        public record Response(ActionConfigurationDto actionConfiguration) {}
    }

    @PUT
    @Path("/{id}")
    public UpdateActionConfigurationRequest.Response update(@PathParam("id") String id, @Valid UpdateActionConfigurationRequest request) {
        var config = actionConfigurationService.update(
            id, request.name(), request.description(), request.executeScript(), request.checkScript()
        );
        return new UpdateActionConfigurationRequest.Response(
            actionConfigurationMapper.toDto(config)
        );
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
}
