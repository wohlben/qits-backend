package eu.wohlben.qits.mutiny.api;

import eu.wohlben.qits.mutiny.control.RequestContext;
import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import java.time.Duration;

@Path("/context")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ContextPropagationController {

    @Inject
    RequestContext requestContext;

    public static record TraceResponse(String traceId, String source) {}

    @GET
    @Path("/trace")
    public Uni<TraceResponse> getTrace(@HeaderParam("X-Trace-Id") String traceId) {
        requestContext.setTraceId(traceId);
        return Uni.createFrom().item("ok")
            .onItem().delayIt().by(Duration.ofMillis(10))
            .map(ignored -> new TraceResponse(requestContext.getTraceId(), "async"));
    }

    @POST
    @Path("/chain")
    public Uni<TraceResponse> chainTrace(@HeaderParam("X-Trace-Id") String traceId) {
        requestContext.setTraceId(traceId);
        return Uni.createFrom().item("step1")
            .chain(s -> Uni.createFrom().item("step2")
                .map(ignored -> new TraceResponse(requestContext.getTraceId(), "chained")));
    }
}
