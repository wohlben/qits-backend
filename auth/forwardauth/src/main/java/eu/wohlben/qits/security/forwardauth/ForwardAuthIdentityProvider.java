package eu.wohlben.qits.security.forwardauth;

import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.TrustedAuthenticationRequest;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.stream.Stream;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Completes {@link ForwardAuthMechanism}'s trusted request into a {@link SecurityIdentity}: the
 * principal is the header-supplied username, roles come from the proxy's comma-separated groups
 * header so {@code qits.auth.required-role} (in auth-core's policy) works identically to the oauth
 * variant's token roles.
 */
@ApplicationScoped
public class ForwardAuthIdentityProvider implements IdentityProvider<TrustedAuthenticationRequest> {

  @ConfigProperty(name = "qits.auth.forward.groups-header")
  String groupsHeader;

  @Override
  public Class<TrustedAuthenticationRequest> getRequestType() {
    return TrustedAuthenticationRequest.class;
  }

  @Override
  public Uni<SecurityIdentity> authenticate(
      TrustedAuthenticationRequest request, AuthenticationRequestContext context) {
    QuarkusSecurityIdentity.Builder builder =
        QuarkusSecurityIdentity.builder()
            .setPrincipal(new QuarkusPrincipal(request.getPrincipal()));
    RoutingContext routingContext = HttpSecurityUtils.getRoutingContextAttribute(request);
    String groups =
        routingContext == null ? null : routingContext.request().getHeader(groupsHeader);
    if (groups != null) {
      Stream.of(groups.split(","))
          .map(String::trim)
          .filter(group -> !group.isEmpty())
          .forEach(builder::addRole);
    }
    return Uni.createFrom().item(builder.build());
  }
}
