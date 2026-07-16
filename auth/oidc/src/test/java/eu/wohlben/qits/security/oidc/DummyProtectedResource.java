package eu.wohlben.qits.security.oidc;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

/**
 * Test stand-in for the service app's JAX-RS surface (this module cannot depend on service —
 * circular). Served under /api/dummy: the test application.properties mirrors service's {@code
 * quarkus.rest.path=/api}.
 */
@Path("/dummy")
public class DummyProtectedResource {

  @GET
  public String get() {
    return "ok";
  }
}
