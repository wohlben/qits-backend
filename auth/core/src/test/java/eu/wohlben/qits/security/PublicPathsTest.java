package eu.wohlben.qits.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Plain JUnit over the framework-free path matcher — the public/protected split in one place. */
class PublicPathsTest {

  @Test
  void healthAndFrameworkPathsArePublic() {
    assertTrue(PublicPaths.isPublic("/q"));
    assertTrue(PublicPaths.isPublic("/q/health"));
    assertTrue(PublicPaths.isPublic("/q/health/ready"));
    assertFalse(PublicPaths.isPublic("/qq")); // prefix must not bleed past the segment
  }

  @Test
  void containerFacingPathsArePublic() {
    assertTrue(PublicPaths.isPublic("/git/abc-123/info/refs"));
    assertTrue(PublicPaths.isPublic("/mcp"));
    assertTrue(PublicPaths.isPublic("/mcp/repository"));
    assertTrue(PublicPaths.isPublic("/mcp/actions"));
    assertTrue(PublicPaths.isPublic("/api/otel/v1/traces"));
    assertTrue(PublicPaths.isPublic("/api/otel/v1/logs"));
  }

  @Test
  void captureIsPublicExactlyNotAsPrefix() {
    assertTrue(PublicPaths.isPublic("/api/capture"));
    assertFalse(PublicPaths.isPublic("/api/captures"));
    assertFalse(PublicPaths.isPublic("/api/capture/extra"));
  }

  @Test
  void authEndpointsArePublic() {
    assertTrue(PublicPaths.isPublic("/api/auth/me"));
    assertTrue(PublicPaths.isPublic("/api/auth/logout"));
  }

  @Test
  void agentSessionReportHookIsPublicOnlyForTheExactShape() {
    assertTrue(PublicPaths.isPublic("/api/commands/abc-123/agent-session"));
    assertFalse(PublicPaths.isPublic("/api/commands/abc-123/agent-session/extra"));
    assertFalse(PublicPaths.isPublic("/api/commands/abc/nested/agent-session"));
    assertFalse(PublicPaths.isPublic("/api/commands/abc-123"));
  }

  @Test
  void uiSurfaceIsProtected() {
    assertFalse(PublicPaths.isPublic("/"));
    assertFalse(PublicPaths.isPublic("/index.html"));
    assertFalse(PublicPaths.isPublic("/api/projects"));
    assertFalse(PublicPaths.isPublic("/api/repositories/r1/workspaces/w1/events"));
    assertFalse(PublicPaths.isPublic("/api/terminal/commands/c1"));
    assertFalse(PublicPaths.isPublic("/daemon/w1/d1/"));
    assertFalse(PublicPaths.isPublic("/git")); // only the subtree is public, not the bare path
  }
}
