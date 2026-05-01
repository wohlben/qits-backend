package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseService;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseDto;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhase;
import eu.wohlben.qits.domain.featureflow.mapper.FeatureFlowPhaseMapper;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import java.util.List;

@Path("/feature-flow-phases")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Transactional
public class FeatureFlowPhaseController {

    @Inject
    FeatureFlowPhaseService featureFlowPhaseService;

    @Inject
    FeatureFlowPhaseMapper featureFlowPhaseMapper;

    public static record CreateFeatureFlowPhaseRequest(
        @NotBlank String featureFlowConfigurationId,
        @NotBlank String name,
        String description,
        @NotNull int orderIndex,
        String parentPhaseId
    ) {
        public record Response(FeatureFlowPhaseDto featureFlowPhase) {}
    }

    @POST
    public CreateFeatureFlowPhaseRequest.Response create(@Valid CreateFeatureFlowPhaseRequest request) {
        var phase = featureFlowPhaseService.create(
            request.featureFlowConfigurationId(),
            request.name(),
            request.description(),
            request.orderIndex(),
            request.parentPhaseId()
        );
        return new CreateFeatureFlowPhaseRequest.Response(
            featureFlowPhaseMapper.toDto(phase)
        );
    }

    public static record GetFeatureFlowPhaseRequest() {
        public record Response(FeatureFlowPhaseDto featureFlowPhase) {}
    }

    @GET
    @Path("/{id}")
    public GetFeatureFlowPhaseRequest.Response get(@PathParam("id") String id) {
        var phase = featureFlowPhaseService.get(id);
        return new GetFeatureFlowPhaseRequest.Response(
            featureFlowPhaseMapper.toDto(phase)
        );
    }

    public static record ListFeatureFlowPhasesRequest() {
        public record Response(List<Entry> entries) {
            public record Entry(FeatureFlowPhaseDto featureFlowPhase) {}
        }
    }

    @GET
    public ListFeatureFlowPhasesRequest.Response list(@QueryParam("featureFlowConfigurationId") String featureFlowConfigurationId) {
        List<FeatureFlowPhase> phases = featureFlowConfigurationId != null
            ? featureFlowPhaseService.listByFeatureFlowConfiguration(featureFlowConfigurationId)
            : featureFlowPhaseService.listAll();
        var entries = phases.stream()
            .map(p -> new ListFeatureFlowPhasesRequest.Response.Entry(
                featureFlowPhaseMapper.toDto(p)
            ))
            .toList();
        return new ListFeatureFlowPhasesRequest.Response(entries);
    }

    public static record UpdateFeatureFlowPhaseRequest(
        String name,
        String description,
        Integer orderIndex,
        String parentPhaseId
    ) {
        public record Response(FeatureFlowPhaseDto featureFlowPhase) {}
    }

    @PUT
    @Path("/{id}")
    public UpdateFeatureFlowPhaseRequest.Response update(@PathParam("id") String id, @Valid UpdateFeatureFlowPhaseRequest request) {
        var phase = featureFlowPhaseService.update(
            id, request.name(), request.description(), request.orderIndex(), request.parentPhaseId()
        );
        return new UpdateFeatureFlowPhaseRequest.Response(
            featureFlowPhaseMapper.toDto(phase)
        );
    }

    public static record DeleteFeatureFlowPhaseRequest() {
        public record Response(boolean success) {}
    }

    @DELETE
    @Path("/{id}")
    public DeleteFeatureFlowPhaseRequest.Response delete(@PathParam("id") String id) {
        featureFlowPhaseService.delete(id);
        return new DeleteFeatureFlowPhaseRequest.Response(true);
    }
}
