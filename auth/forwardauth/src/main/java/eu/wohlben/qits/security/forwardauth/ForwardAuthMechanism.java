package eu.wohlben.qits.security.forwardauth;

import io.quarkus.runtime.LaunchMode;
import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.AuthenticationRequest;
import io.quarkus.security.identity.request.TrustedAuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The forwardauth build variant's authentication: trust the identity headers a forward-auth proxy
 * (Authelia, oauth2-proxy, traefik-forward-auth, …) injects after doing the actual login. The proxy
 * MUST strip client-supplied copies of these headers — qits believes them unconditionally; that
 * trust boundary is the whole point of the variant (and why qits publishes no host port in the prod
 * compose). Missing header on a protected path ⇒ anonymous ⇒ {@code QitsAuthPolicy} denies ⇒ the
 * challenge here is a plain 401: the proxy owns login, qits has nothing to redirect to.
 */
@ApplicationScoped
public class ForwardAuthMechanism implements HttpAuthenticationMechanism {

  @ConfigProperty(name = "qits.auth.forward.user-header")
  String userHeader;

  @ConfigProperty(name = "qits.auth.forward.dev-user")
  Optional<String> devUser;

  @Override
  public Uni<SecurityIdentity> authenticate(
      RoutingContext context, IdentityProviderManager identityProviderManager) {
    String user = context.request().getHeader(userHeader);
    if (user == null || user.isBlank()) {
      // The %dev/%test-scoped synthetic identity (no proxy in front of dev mode or the test
      // suite). LaunchMode-guarded on top of the config scoping: a prod build stays anonymous
      // even if the property leaks in via env.
      if (devUser.isEmpty() || LaunchMode.current() == LaunchMode.NORMAL) {
        return Uni.createFrom().nullItem();
      }
      user = devUser.get();
    }
    // Through the IdentityProviderManager (not building the identity here) so
    // SecurityIdentityAugmentors keep working; the RoutingContext attribute lets the provider read
    // the groups header.
    return identityProviderManager.authenticate(
        HttpSecurityUtils.setRoutingContextAttribute(
            new TrustedAuthenticationRequest(user), context));
  }

  @Override
  public Uni<ChallengeData> getChallenge(RoutingContext context) {
    return Uni.createFrom().item(new ChallengeData(401, null, null));
  }

  @Override
  public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
    return Set.of(TrustedAuthenticationRequest.class);
  }
}
