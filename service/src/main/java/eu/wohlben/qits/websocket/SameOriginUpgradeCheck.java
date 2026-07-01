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
 * {@code Host}, or any loopback origin ({@code localhost}/{@code 127.0.0.1}/{@code ::1}, possibly
 * reached through a dev proxy or OS port-forward where {@code Host} and {@code Origin} differ). A
 * malicious internet site ({@code https://evil.example}) matches none of these and is blocked. qits
 * has no authentication layer (a local prototype); a networked deployment would add real auth on
 * top.
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
    return isLoopback(hostOnly(originAuthority)); // same-machine access, blocks real cross-site
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
