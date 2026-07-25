package eu.wohlben.qits.security.local;

import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.TrustedAuthenticationRequest;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import java.util.Optional;
import java.util.stream.Stream;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Completes {@link LocalAuthMechanism}'s request into a {@link SecurityIdentity}: the principal is
 * the fixed local username, and roles come from the optional {@code qits.auth.local.groups}
 * comma-separated config so {@code qits.auth.required-role} (auth-core's policy) can still be
 * exercised locally — the same shape as forwardauth's groups-header roles, only config-supplied
 * since there is no proxy.
 */
@jakarta.enterprise.context.ApplicationScoped
public class LocalIdentityProvider implements IdentityProvider<TrustedAuthenticationRequest> {

  @ConfigProperty(name = "qits.auth.local.groups")
  Optional<String> groups;

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
    groups.ifPresent(
        g ->
            Stream.of(g.split(","))
                .map(String::trim)
                .filter(role -> !role.isEmpty())
                .forEach(builder::addRole));
    return Uni.createFrom().item(builder.build());
  }
}
