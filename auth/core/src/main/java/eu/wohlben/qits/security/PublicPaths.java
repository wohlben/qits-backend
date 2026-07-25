package eu.wohlben.qits.security;

/**
 * The token-free surface: paths whose callers cannot hold a user token — workspace containers (git
 * clone/push, OTLP export, MCP), the cross-origin fixture SPA's capture POST, health probes — plus
 * {@code /api/auth/*} (the "who am I" endpoint and, in the oauth variant, the OIDC-intercepted
 * logout path must work for anonymous browsers). Workspace containers reach qits directly on
 * qits-net, bypassing any forward-auth proxy, so this list is identical for both build variants.
 *
 * <p>Note: the agent's SessionStart hook no longer POSTs the host directly (it targets the
 * workspace-daemon's in-container loopback webhook — agent-activity tracking), so there is no
 * agent-session endpoint on this list anymore.
 */
public final class PublicPaths {

  private PublicPaths() {}

  /** Expects a normalized path (dot-segments collapsed) — see {@code QitsAuthPolicy}. */
  public static boolean isPublic(String path) {
    return path.equals("/q")
        || path.startsWith("/q/") // health/readiness probes (compose healthcheck, orchestrators)
        || path.startsWith("/git/") // container clone/push against the in-process git host
        || path.equals("/mcp")
        || path.startsWith("/mcp/") // the coding agent's MCP servers, called in-container
        || path.startsWith(
            "/api/workspace-daemon/") // in-container workspace-daemon's dial-home control socket
        || path.startsWith("/api/otel/") // OTLP ingest from containers and fixture SPAs
        || path.equals("/api/capture") // cross-origin capture ingest (own CORS route)
        || path.startsWith(
            "/api/artifacts/") // blob store: CI uploaders (writes token-guarded) + <img> serves
        || path.equals("/api/artifacts")
        || path.equals("/api/config.json") // the SPA identity relay, fetched pre-bootstrap
        || path.startsWith("/api/auth/"); // /api/auth/me + the oauth variant's logout path
  }
}
