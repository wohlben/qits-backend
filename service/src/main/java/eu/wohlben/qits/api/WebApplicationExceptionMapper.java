package eu.wohlben.qits.api;

import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.Map;

@Provider
public class WebApplicationExceptionMapper implements ExceptionMapper<WebApplicationException> {

    @Override
    public Response toResponse(WebApplicationException exception) {
        int status = exception.getResponse().getStatus();
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            message = Response.Status.fromStatusCode(status).getReasonPhrase();
        }
        return Response.status(status)
            .entity(Map.of("message", message))
            .type(MediaType.APPLICATION_JSON)
            .build();
    }
}
