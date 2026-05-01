package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowConfigurationService;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowConfigurationDto;
import eu.wohlben.qits.domain.featureflow.mapper.FeatureFlowConfigurationMapper;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import eu.wohlben.qits.validation.NotBlankIfPresent;
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

@Path("/feature-flow-configurations")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Transactional
public class FeatureFlowConfigurationController {

    @Inject
    FeatureFlowConfigurationService featureFlowConfigurationService;

    @Inject
    FeatureFlowConfigurationMapper featureFlowConfigurationMapper;

    public static record CreateFeatureFlowConfigurationRequest(
        @NotBlank String name
    ) {
        public record Response(FeatureFlowConfigurationDto featureFlowConfiguration) {}
    }

    @POST
    public CreateFeatureFlowConfigurationRequest.Response create(@Valid CreateFeatureFlowConfigurationRequest request) {
        var config = featureFlowConfigurationService.create(request.name());
        return new CreateFeatureFlowConfigurationRequest.Response(
            featureFlowConfigurationMapper.toDto(config)
        );
    }

    public static record GetFeatureFlowConfigurationRequest() {
        public record Response(FeatureFlowConfigurationDto featureFlowConfiguration) {}
    }

    @GET
    @Path("/{id}")
    public GetFeatureFlowConfigurationRequest.Response get(@PathParam("id") String id) {
        var config = featureFlowConfigurationService.get(id);
        return new GetFeatureFlowConfigurationRequest.Response(
            featureFlowConfigurationMapper.toDto(config)
        );
    }

    public static record ListFeatureFlowConfigurationsRequest() {
        public record Response(List<Entry> entries) {
            public record Entry(FeatureFlowConfigurationDto featureFlowConfiguration) {}
        }
    }

    @GET
    public ListFeatureFlowConfigurationsRequest.Response list() {
        var configs = featureFlowConfigurationService.list();
        var entries = configs.stream()
            .map(c -> new ListFeatureFlowConfigurationsRequest.Response.Entry(
                featureFlowConfigurationMapper.toDto(c)
            ))
            .toList();
        return new ListFeatureFlowConfigurationsRequest.Response(entries);
    }

    public static record UpdateFeatureFlowConfigurationRequest(
        @NotBlankIfPresent String name
    ) {
        public record Response(FeatureFlowConfigurationDto featureFlowConfiguration) {}
    }

    @PUT
    @Path("/{id}")
    public UpdateFeatureFlowConfigurationRequest.Response update(@PathParam("id") String id, @Valid UpdateFeatureFlowConfigurationRequest request) {
        var config = featureFlowConfigurationService.update(id, request.name());
        return new UpdateFeatureFlowConfigurationRequest.Response(
            featureFlowConfigurationMapper.toDto(config)
        );
    }

    public static record DeleteFeatureFlowConfigurationRequest() {
        public record Response(boolean success) {}
    }

    @DELETE
    @Path("/{id}")
    public DeleteFeatureFlowConfigurationRequest.Response delete(@PathParam("id") String id) {
        featureFlowConfigurationService.delete(id);
        return new DeleteFeatureFlowConfigurationRequest.Response(true);
    }
}
