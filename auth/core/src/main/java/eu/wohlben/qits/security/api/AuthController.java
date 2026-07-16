package eu.wohlben.qits.security.api;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Auth introspection for the SPA (public path — see {@code QitsAuthPolicy}): which auth variant
 * this build carries and who is logged in, so the shell can render the user chip and — for the
 * oauth variant — the sign-out link. In the oauth variant the sibling {@code /api/auth/logout} has
 * no controller: quarkus-oidc intercepts its configured logout path in the authentication mechanism
 * itself; forwardauth has no qits-side logout at all (the proxy owns the session).
 */
@Path("/auth")
@Produces(MediaType.APPLICATION_JSON)
public class AuthController {

  // The anonymous identity instance when no credentials came along (public paths).
  @Inject SecurityIdentity identity;

  // Defined by the variant module's META-INF/microprofile-config.properties — the variant contract
  // (see this package's package-info).
  @ConfigProperty(name = "qits.auth.variant")
  String variant;

  public static record GetAuthStatusRequest() {
    public record Response(String variant, String username) {}
  }

  @GET
  @Path("/me")
  public GetAuthStatusRequest.Response me() {
    String username = identity.isAnonymous() ? null : identity.getPrincipal().getName();
    return new GetAuthStatusRequest.Response(variant, username);
  }
}
