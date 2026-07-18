package eu.wohlben.qits.security.oidc;

import io.quarkus.oidc.JavaScriptRequestChecker;
import io.vertx.core.http.HttpServerRequest;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;

/**
 * Widens quarkus-oidc's "don't 302 this request" decision from marked XHRs to every request no
 * browser can usefully redirect to Keycloak (docs/issues/resolved/
 * 2026-07-18_oidc-expired-session-reload-loop.md). Registering this bean REPLACES the built-in
 * {@code X-Requested-With} check, so that header stays honored here.
 *
 * <p>Why it matters beyond politeness: every code-flow challenge writes the single per-tenant
 * {@code q_auth} state cookie. On a dead session the SPA's header-less transports (EventSource SSE,
 * WebSocket handshakes) used to receive 302 challenges whose state cookies clobbered the one the
 * user's in-flight document code flow needed — the state mismatch on return restarted the
 * challenge, producing the nonstop reload/flicker loop. Answering them 499 (paired with {@code
 * java-script-auto-redirect=false}) mints no state cookie: only real navigations enter the code
 * flow.
 */
@ApplicationScoped
public class NonNavigationRequestChecker implements JavaScriptRequestChecker {

  @Override
  public boolean isJavaScriptRequest(RoutingContext context) {
    HttpServerRequest request = context.request();
    String requestedWith = request.getHeader("X-Requested-With");
    if ("JavaScript".equals(requestedWith) || "XMLHttpRequest".equals(requestedWith)) {
      return true;
    }
    if (request.getHeader("Sec-WebSocket-Key") != null) {
      return true; // WebSocket upgrade — a 302 kills the handshake, nothing follows it
    }
    String accept = request.getHeader("Accept");
    if (accept != null && accept.contains("text/event-stream")) {
      return true; // EventSource — follows the redirect into Keycloak HTML, then dies
    }
    // Browsers stamp every fetch/XHR/preload with Sec-Fetch-Mode; only real navigations
    // ("navigate") can render the Keycloak login page. Absent header (curl, older clients) keeps
    // the redirect default.
    String fetchMode = request.getHeader("Sec-Fetch-Mode");
    return fetchMode != null && !"navigate".equals(fetchMode);
  }
}
