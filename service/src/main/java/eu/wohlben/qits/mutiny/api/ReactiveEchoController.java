package eu.wohlben.qits.mutiny.api;

import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import java.time.Duration;

@Path("/echo")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ReactiveEchoController {

    public static record EchoRequest(String message) {}
    public static record EchoResponse(String echo, int length) {}

    @GET
    @Path("/reactive/{message}")
    public Uni<EchoResponse> echoReactive(@PathParam("message") String message) {
        return Uni.createFrom().item(message)
            .map(String::toUpperCase)
            .onItem().transform(upper -> new EchoResponse(upper, upper.length()));
    }

    @POST
    @Path("/reactive")
    public Uni<EchoResponse> echoReactivePost(EchoRequest request) {
        return Uni.createFrom().item(request.message())
            .onItem().delayIt().by(Duration.ofMillis(10))
            .map(msg -> new EchoResponse(msg, msg.length()));
    }
}
