package eu.wohlben.qits.websocket;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The same-origin / loopback allowlist that guards WebSocket upgrades against CSWSH. */
class SameOriginUpgradeCheckTest {

  @Test
  void permitsExactSameOrigin() {
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://localhost:8080", "localhost:8080"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("https://qits.example", "qits.example"));
  }

  @Test
  void permitsLoopbackOriginThroughADevProxy() {
    // The reported case: page served by the Angular dev server, ws proxied to Quarkus.
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://127.0.0.1:4200", "localhost:8080"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://localhost:4200", "localhost:8080"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://[::1]:4200", "localhost:8080"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://127.0.0.5:9999", "localhost:8080"));
  }

  @Test
  void permitsAbsentOrigin() {
    // Non-browser client (curl, native) — no ambient credentials, not a CSWSH vector.
    assertTrue(SameOriginUpgradeCheck.isAllowed(null, "localhost:8080"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("", "localhost:8080"));
  }

  @Test
  void permitsSameOriginWhenTheProxyPinsTheDefaultPortOntoHost() {
    // The prod encounter (2026-07-17, Dokploy/Traefik + oauth): with
    // quarkus.http.proxy.enable-forwarded-host, Vert.x rewrites the request authority from
    // X-Forwarded-Host/-Port to "<host>:443", while a browser Origin never serializes its
    // scheme's default port — the comparison must equate the two.
    assertTrue(SameOriginUpgradeCheck.isAllowed("https://qits.example", "qits.example:443"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("http://qits.example", "qits.example:80"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("https://qits.example:443", "qits.example"));
    assertTrue(SameOriginUpgradeCheck.isAllowed("HTTPS://QITS.example", "qits.EXAMPLE:443"));
  }

  @Test
  void rejectsSameHostWithMismatchedEffectivePorts() {
    // Default-port normalization must not degrade into host-only matching.
    assertFalse(SameOriginUpgradeCheck.isAllowed("https://qits.example", "qits.example:8443"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("https://qits.example:8443", "qits.example"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://qits.example", "qits.example:443"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("https://qits.example", "qits.example:garbage"));
  }

  @Test
  void rejectsForeignOrigins() {
    assertFalse(SameOriginUpgradeCheck.isAllowed("https://evil.example", "localhost:8080"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://attacker.test:8080", "localhost:8080"));
  }

  @Test
  void rejectsHostnamesThatMerelyLookLoopback() {
    // The substring/unanchored bypass: these are attacker-controlled DNS names, not loopback.
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://127.0.0.1.evil.com", "localhost:8080"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://127.0.0.1x", "localhost:8080"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://localhost.evil.com", "localhost:8080"));
    assertFalse(SameOriginUpgradeCheck.isAllowed("http://1270.0.0.1", "localhost:8080"));
  }
}
