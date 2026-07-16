package eu.wohlben.qits.security;

import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityPolicy;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * The single authorization decision, shared by every auth build variant (see
 * docs/features/2026-07-16_build-variant-auth.md). A <em>global</em> {@link HttpSecurityPolicy}
 * ({@code name()} stays {@code null}): Quarkus mounts the authentication/authorization handlers on
 * the main Vert.x router ahead of every user route, so this covers the JAX-RS tree under {@code
 * /api}, the raw router routes ({@code /git} host, {@code /daemon} proxy), the MCP servers, the
 * websockets-next upgrades, and Quinoa's static/SPA serving alike.
 *
 * <p>Always enforcing — there is no runtime off switch; an unauthenticated qits exists only as a
 * build that includes no auth module, which the build setup forbids. The paths workspace containers
 * and cross-origin fixture SPAs call stay public (those clients cannot carry a user token; they
 * reach qits directly on qits-net, bypassing any proxy), and everything else — including the SPA
 * itself, so the login wall appears before the app loads — requires an authenticated identity.
 * Denying an anonymous identity triggers the variant's mechanism challenge (oauth: 302 code flow
 * for browsers, 401 for bad bearer tokens, 499 for XHRs marked {@code X-Requested-With:
 * JavaScript}; forwardauth: plain 401 — the proxy owns login); denying an authenticated one yields
 * 403.
 */
@ApplicationScoped
public class QitsAuthPolicy implements HttpSecurityPolicy {

  @ConfigProperty(name = "qits.auth.required-role")
  Optional<String> requiredRole;

  @Override
  public Uni<CheckResult> checkPermission(
      RoutingContext context,
      Uni<SecurityIdentity> deferredIdentity,
      AuthorizationRequestContext requestContext) {
    // normalizedPath(): dot-segments and duplicate slashes are already collapsed, so a path like
    // /api/../git/x cannot spoof its way into a public prefix.
    if (PublicPaths.isPublic(context.normalizedPath())) {
      return CheckResult.permit();
    }
    return deferredIdentity.onItem().transform(this::decide);
  }

  private CheckResult decide(SecurityIdentity identity) {
    if (identity == null || identity.isAnonymous()) {
      return CheckResult.DENY; // anonymous deny → HttpAuthenticator sends the mechanism challenge
    }
    if (requiredRole.isPresent() && !identity.getRoles().contains(requiredRole.get())) {
      return CheckResult.DENY; // authenticated deny → 403
    }
    return CheckResult.PERMIT;
  }
}
