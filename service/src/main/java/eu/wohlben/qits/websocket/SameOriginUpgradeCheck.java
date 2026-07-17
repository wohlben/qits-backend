package eu.wohlben.qits.websocket;

import io.quarkus.websockets.next.HttpUpgradeCheck;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import org.jboss.logging.Logger;

/**
 * Rejects cross-origin WebSocket handshakes on every {@code @WebSocket} endpoint, guarding against
 * Cross-Site WebSocket Hijacking — where a page the user visits opens a socket to their locally
 * running qits and drives it (e.g. spawning an autonomous Claude session on {@code /api/chat}).
 *
 * <p>Browsers always send an {@code Origin} header a cross-site page cannot forge, so a foreign
 * origin is rejected. Legitimate access to this local app is permitted generously: an absent origin
 * (non-browser client, no ambient credentials), an origin whose authority matches the request
 * {@code Host} — modulo the scheme's default port, which browser Origins omit but a TLS-terminating
 * proxy's forwarded authority may pin on as {@code :443} — or any loopback origin ({@code
 * localhost}/{@code 127.0.0.1}/{@code ::1}, possibly reached through a dev proxy or OS port-forward
 * where {@code Host} and {@code Origin} differ). A malicious internet site ({@code
 * https://evil.example}) matches none of these and is blocked. This guard is origin-based, not
 * identity-based; it stays in place underneath the identity-based {@code QitsAuthPolicy}
 * (auth-core), which additionally requires an authenticated identity on these upgrades in every
 * auth build variant.
 */
@ApplicationScoped
public class SameOriginUpgradeCheck implements HttpUpgradeCheck {

  private static final Logger LOG = Logger.getLogger(SameOriginUpgradeCheck.class);

  @Override
  public Uni<CheckResult> perform(HttpUpgradeContext context) {
    String origin = context.httpRequest().getHeader("Origin");
    String host = context.httpRequest().getHeader("Host");
    if (isAllowed(origin, host)) {
      return CheckResult.permitUpgrade();
    }
    LOG.infof(
        "Rejected cross-origin WebSocket upgrade (path=%s origin=%s host=%s)",
        context.httpRequest().path(), origin, host);
    return CheckResult.rejectUpgrade(403);
  }

  static boolean isAllowed(String origin, String host) {
    if (origin == null || origin.isBlank()) {
      return true; // non-browser client — not a CSWSH vector
    }
    String originAuthority = stripScheme(origin);
    if (host != null && originAuthority.equalsIgnoreCase(host)) {
      return true; // exact same-origin
    }
    if (host != null && sameAuthorityModuloDefaultPort(origin, originAuthority, host)) {
      return true; // same-origin behind a TLS-terminating proxy that pins :443/:80 onto Host
    }
    return isLoopback(hostOnly(originAuthority)); // same-machine access, blocks real cross-site
  }

  /**
   * True when the origin and the request authority name the same host and their effective ports
   * agree once the origin scheme's default port is filled in. A browser {@code Origin} never
   * serializes its scheme's default port (RFC 6454), but the request authority behind a
   * TLS-terminating proxy often carries it explicitly: with {@code
   * quarkus.http.proxy.enable-forwarded-host}, Vert.x rewrites the authority from {@code
   * X-Forwarded-Host}/{@code -Port} to e.g. {@code qits.example:443} — which must still count as
   * same-origin against {@code Origin: https://qits.example}.
   */
  private static boolean sameAuthorityModuloDefaultPort(
      String origin, String originAuthority, String host) {
    if (!hostOnly(originAuthority).equalsIgnoreCase(hostOnly(host))) {
      return false;
    }
    int defaultPort = defaultPort(origin);
    if (defaultPort < 0) {
      return false; // unknown scheme — no default to fill in, and exact match already failed
    }
    int originPort = port(originAuthority, defaultPort);
    return originPort > 0 && originPort == port(host, defaultPort);
  }

  private static int defaultPort(String origin) {
    if (origin.regionMatches(true, 0, "https://", 0, 8)) {
      return 443;
    }
    if (origin.regionMatches(true, 0, "http://", 0, 7)) {
      return 80;
    }
    return -1;
  }

  /**
   * The explicit port of an {@code host[:port]} authority (bracketed-IPv6-aware), {@code
   * defaultPort} when absent, {@code -1} when malformed.
   */
  private static int port(String authority, int defaultPort) {
    int hostEnd;
    if (authority.startsWith("[")) {
      hostEnd = authority.indexOf(']') + 1;
      if (hostEnd == 0) {
        return -1; // unterminated bracket
      }
    } else {
      int colon = authority.indexOf(':');
      hostEnd = colon >= 0 ? colon : authority.length();
    }
    if (hostEnd >= authority.length()) {
      return defaultPort;
    }
    if (authority.charAt(hostEnd) != ':') {
      return -1;
    }
    try {
      int port = Integer.parseInt(authority.substring(hostEnd + 1));
      return port > 0 && port <= 65535 ? port : -1;
    } catch (NumberFormatException e) {
      return -1;
    }
  }

  private static String stripScheme(String origin) {
    int scheme = origin.indexOf("://");
    return scheme >= 0 ? origin.substring(scheme + 3) : origin;
  }

  /** The host part of an {@code host[:port]} authority, handling bracketed IPv6. */
  private static String hostOnly(String authority) {
    if (authority.startsWith("[")) {
      int end = authority.indexOf(']');
      return end > 0 ? authority.substring(1, end) : authority;
    }
    int colon = authority.indexOf(':');
    return colon >= 0 ? authority.substring(0, colon) : authority;
  }

  /**
   * True only for a host that is <em>provably</em> this machine's loopback: the literal {@code
   * localhost}, the IPv6 loopback {@code ::1}, or a numeric IPv4 literal in {@code 127.0.0.0/8}. A
   * name that merely looks loopback-ish ({@code 127.0.0.1.evil.com}, {@code localhost.evil.com}) is
   * a DNS hostname the attacker controls, not a loopback address, so it is rejected — and no DNS
   * resolution is performed.
   */
  private static boolean isLoopback(String host) {
    return host.equalsIgnoreCase("localhost") || host.equals("::1") || isIpv4Loopback(host);
  }

  /** True only for a dotted-quad IPv4 literal whose first octet is 127 (127.0.0.0/8). */
  private static boolean isIpv4Loopback(String host) {
    String[] octets = host.split("\\.", -1);
    if (octets.length != 4) {
      return false;
    }
    for (String octet : octets) {
      if (octet.isEmpty() || octet.length() > 3) {
        return false;
      }
      for (int i = 0; i < octet.length(); i++) {
        if (!Character.isDigit(octet.charAt(i))) {
          return false;
        }
      }
      if (Integer.parseInt(octet) > 255) {
        return false;
      }
    }
    return Integer.parseInt(octets[0]) == 127;
  }
}
