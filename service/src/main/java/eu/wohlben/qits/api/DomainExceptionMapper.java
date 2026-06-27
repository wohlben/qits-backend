package eu.wohlben.qits.api;

import eu.wohlben.qits.domain.error.DomainException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.Map;

/**
 * Maps domain-layer errors to HTTP responses. The domain throws framework-free {@link
 * DomainException}s (carrying a status code) so it doesn't depend on JAX-RS; this translates them
 * to the same JSON shape as {@link WebApplicationExceptionMapper}.
 */
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

  @Override
  public Response toResponse(DomainException exception) {
    int status = exception.statusCode();
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
