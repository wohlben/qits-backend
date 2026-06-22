package eu.wohlben.qits.domain.featureflow.api;

import eu.wohlben.qits.domain.featureflow.control.FeatureFlowPhaseActionService;
import eu.wohlben.qits.domain.featureflow.dto.FeatureFlowPhaseActionDto;
import eu.wohlben.qits.domain.featureflow.entity.ActionType;
import eu.wohlben.qits.domain.featureflow.entity.FeatureFlowPhaseAction;
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

@Path("/feature-flow-phase-actions")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Transactional
public class FeatureFlowPhaseActionController {

  @Inject FeatureFlowPhaseActionService featureFlowPhaseActionService;

  @Inject FeatureFlowPhaseMapper featureFlowPhaseMapper;

  public static record CreateFeatureFlowPhaseActionRequest(
      @NotBlank String stepId,
      @NotBlank String actionConfigurationId,
      @NotNull ActionType actionType,
      @NotNull int sortOrder,
      String parallelGroup) {
    public record Response(FeatureFlowPhaseActionDto featureFlowPhaseAction) {}
  }

  @POST
  public CreateFeatureFlowPhaseActionRequest.Response create(
      @Valid CreateFeatureFlowPhaseActionRequest request) {
    var link =
        featureFlowPhaseActionService.create(
            request.stepId(),
            request.actionConfigurationId(),
            request.actionType(),
            request.sortOrder(),
            request.parallelGroup());
    return new CreateFeatureFlowPhaseActionRequest.Response(
        featureFlowPhaseMapper.toActionDto(link));
  }

  public static record GetFeatureFlowPhaseActionRequest() {
    public record Response(FeatureFlowPhaseActionDto featureFlowPhaseAction) {}
  }

  @GET
  @Path("/{id}")
  public GetFeatureFlowPhaseActionRequest.Response get(@PathParam("id") String id) {
    var link = featureFlowPhaseActionService.get(id);
    return new GetFeatureFlowPhaseActionRequest.Response(featureFlowPhaseMapper.toActionDto(link));
  }

  public static record ListFeatureFlowPhaseActionsRequest() {
    public record Response(List<Entry> entries) {
      public record Entry(FeatureFlowPhaseActionDto featureFlowPhaseAction) {}
    }
  }

  @GET
  public ListFeatureFlowPhaseActionsRequest.Response list(@QueryParam("stepId") String stepId) {
    List<FeatureFlowPhaseAction> links =
        stepId != null
            ? featureFlowPhaseActionService.listByStep(stepId)
            : featureFlowPhaseActionService.listAll();
    var entries =
        links.stream()
            .map(
                l ->
                    new ListFeatureFlowPhaseActionsRequest.Response.Entry(
                        featureFlowPhaseMapper.toActionDto(l)))
            .toList();
    return new ListFeatureFlowPhaseActionsRequest.Response(entries);
  }

  public static record UpdateFeatureFlowPhaseActionRequest(
      ActionType actionType, Integer sortOrder, String parallelGroup) {
    public record Response(FeatureFlowPhaseActionDto featureFlowPhaseAction) {}
  }

  @PUT
  @Path("/{id}")
  public UpdateFeatureFlowPhaseActionRequest.Response update(
      @PathParam("id") String id, @Valid UpdateFeatureFlowPhaseActionRequest request) {
    var link =
        featureFlowPhaseActionService.update(
            id, request.actionType(), request.sortOrder(), request.parallelGroup());
    return new UpdateFeatureFlowPhaseActionRequest.Response(
        featureFlowPhaseMapper.toActionDto(link));
  }

  public static record DeleteFeatureFlowPhaseActionRequest() {
    public record Response(boolean success) {}
  }

  @DELETE
  @Path("/{id}")
  public DeleteFeatureFlowPhaseActionRequest.Response delete(@PathParam("id") String id) {
    featureFlowPhaseActionService.delete(id);
    return new DeleteFeatureFlowPhaseActionRequest.Response(true);
  }
}
