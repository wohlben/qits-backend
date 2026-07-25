package eu.wohlben.qits.security.local;

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
import java.util.Set;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The {@code local} build variant's "authentication": every request is authenticated as one fixed
 * local identity — no proxy, no header, no login. The deliberately open variant for trusted LOCAL
 * starts: a workspace's own packaged qits serving behind the parent on qits-net, or a laptop run
 * where standing up an IdP or a forward-auth proxy is pointless overhead.
 *
 * <p>Two things distinguish it from {@link
 * eu.wohlben.qits.security.forwardauth.ForwardAuthMechanism forwardauth}'s dev/test fallback:
 *
 * <ul>
 *   <li>the identity is <b>unconditional</b> — there is no header to supply and none to omit;
 *   <li>it is <b>NOT LaunchMode-guarded</b> — it works in {@code NORMAL} (packaged/prod) launch
 *       mode, which is the whole point (forwardauth deliberately blanks its fallback in NORMAL, so
 *       a packaged forwardauth build stays anonymous without a proxy).
 * </ul>
 *
 * <p><b>SECURITY.</b> A {@code local}-variant qits is <b>open</b> — anyone who can reach it is the
 * local user. It must never be internet-exposed. This is the ONLY build that runs unauthenticated:
 * the auth-scheme variants ({@code forwardauth}/{@code oidc}) never degrade to this under any
 * circumstances (docs/epics/qits-authentication/), so choosing a scheme always enforces it.
 * Selected only by an explicit {@code -Dqits.variant=local}; the flagless dev/test default stays
 * forwardauth.
 */
@ApplicationScoped
public class LocalAuthMechanism implements HttpAuthenticationMechanism {

  @ConfigProperty(name = "qits.auth.local.user")
  String localUser;

  @Override
  public Uni<SecurityIdentity> authenticate(
      RoutingContext context, IdentityProviderManager identityProviderManager) {
    // Always the fixed local identity — through the IdentityProviderManager (not built inline) so
    // SecurityIdentityAugmentors keep working and the groups→roles provider can attach the
    // configured roles, exactly as forwardauth does with its trusted request.
    return identityProviderManager.authenticate(
        HttpSecurityUtils.setRoutingContextAttribute(
            new TrustedAuthenticationRequest(localUser), context));
  }

  @Override
  public Uni<ChallengeData> getChallenge(RoutingContext context) {
    // Unreachable in practice (every request authenticates), but a policy that somehow denies gets
    // a
    // plain 401 rather than a redirect — this variant owns no login to send anyone to.
    return Uni.createFrom().item(new ChallengeData(401, null, null));
  }

  @Override
  public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
    return Set.of(TrustedAuthenticationRequest.class);
  }
}
