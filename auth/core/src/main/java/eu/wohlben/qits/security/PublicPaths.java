package eu.wohlben.qits.security;

import java.util.regex.Pattern;

/**
 * The token-free surface: paths whose callers cannot hold a user token — workspace containers (git
 * clone/push, OTLP export, MCP, the agent-session report hook), the cross-origin fixture SPA's
 * capture POST, health probes — plus {@code /api/auth/*} (the "who am I" endpoint and, in the oauth
 * variant, the OIDC-intercepted logout path must work for anonymous browsers). Workspace containers
 * reach qits directly on qits-net, bypassing any forward-auth proxy, so this list is identical for
 * both build variants.
 */
public final class PublicPaths {

  /** POST from the Claude SessionStart hook inside workspace containers — id mid-path. */
  private static final Pattern AGENT_SESSION = Pattern.compile("/api/commands/[^/]+/agent-session");

  private PublicPaths() {}

  /** Expects a normalized path (dot-segments collapsed) — see {@code QitsAuthPolicy}. */
  public static boolean isPublic(String path) {
    return path.equals("/q")
        || path.startsWith("/q/") // health/readiness probes (compose healthcheck, orchestrators)
        || path.startsWith("/git/") // container clone/push against the in-process git host
        || path.equals("/mcp")
        || path.startsWith("/mcp/") // the coding agent's MCP servers, called in-container
        || path.startsWith("/api/otel/") // OTLP ingest from containers and fixture SPAs
        || path.equals("/api/capture") // cross-origin capture ingest (own CORS route)
        || path.equals("/api/config.json") // the SPA identity relay, fetched pre-bootstrap
        || path.startsWith("/api/auth/") // /api/auth/me + the oauth variant's logout path
        || AGENT_SESSION.matcher(path).matches();
  }
}
