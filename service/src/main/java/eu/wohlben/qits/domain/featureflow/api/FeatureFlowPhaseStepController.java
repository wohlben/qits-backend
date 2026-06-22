package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseStepService;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseStepDto;
import eu.wohlben.qits.domain.featureflow.mapper.FeatureFlowPhaseMapper;
import eu.wohlben.qits.validation.NotBlankIfPresent;
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

@Path("/feature-flow-phase-steps")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Transactional
public class FeatureFlowPhaseStepController {

  @Inject FeatureFlowPhaseStepService featureFlowPhaseStepService;

  @Inject FeatureFlowPhaseMapper featureFlowPhaseMapper;

  public static record CreateFeatureFlowPhaseStepRequest(
      @NotBlank String phaseId, @NotBlank String name, @NotNull int sortOrder) {
    public record Response(FeatureFlowPhaseStepDto featureFlowPhaseStep) {}
  }

  @POST
  public CreateFeatureFlowPhaseStepRequest.Response create(
      @Valid CreateFeatureFlowPhaseStepRequest request) {
    var step =
        featureFlowPhaseStepService.create(request.phaseId(), request.name(), request.sortOrder());
    return new CreateFeatureFlowPhaseStepRequest.Response(featureFlowPhaseMapper.toStepDto(step));
  }

  public static record GetFeatureFlowPhaseStepRequest() {
    public record Response(FeatureFlowPhaseStepDto featureFlowPhaseStep) {}
  }

  @GET
  @Path("/{id}")
  public GetFeatureFlowPhaseStepRequest.Response get(@PathParam("id") String id) {
    var step = featureFlowPhaseStepService.get(id);
    return new GetFeatureFlowPhaseStepRequest.Response(featureFlowPhaseMapper.toStepDto(step));
  }

  public static record ListFeatureFlowPhaseStepsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(FeatureFlowPhaseStepDto featureFlowPhaseStep) {}
    }
  }

  @GET
  public ListFeatureFlowPhaseStepsRequest.Response list(@QueryParam("phaseId") String phaseId) {
    List<eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseStep> steps =
        phaseId != null
            ? featureFlowPhaseStepService.listByPhase(phaseId)
            : featureFlowPhaseStepService.listAll();
    var entries =
        steps.stream()
            .map(
                s ->
                    new ListFeatureFlowPhaseStepsRequest.Response.Entry(
                        featureFlowPhaseMapper.toStepDto(s)))
            .toList();
    return new ListFeatureFlowPhaseStepsRequest.Response(entries);
  }

  public static record UpdateFeatureFlowPhaseStepRequest(
      @NotBlankIfPresent String name, Integer sortOrder) {
    public record Response(FeatureFlowPhaseStepDto featureFlowPhaseStep) {}
  }

  @PUT
  @Path("/{id}")
  public UpdateFeatureFlowPhaseStepRequest.Response update(
      @PathParam("id") String id, @Valid UpdateFeatureFlowPhaseStepRequest request) {
    var step = featureFlowPhaseStepService.update(id, request.name(), request.sortOrder());
    return new UpdateFeatureFlowPhaseStepRequest.Response(featureFlowPhaseMapper.toStepDto(step));
  }

  public static record DeleteFeatureFlowPhaseStepRequest() {
    public record Response(boolean success) {}
  }

  @DELETE
  @Path("/{id}")
  public DeleteFeatureFlowPhaseStepRequest.Response delete(@PathParam("id") String id) {
    featureFlowPhaseStepService.delete(id);
    return new DeleteFeatureFlowPhaseStepRequest.Response(true);
  }
}
