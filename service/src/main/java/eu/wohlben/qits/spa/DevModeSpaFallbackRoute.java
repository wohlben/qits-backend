package eu.wohlben.qits.spa;

import eu.wohlben.qits.http.RootPath;
import io.quarkus.runtime.LaunchMode;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Dev-mode history-API fallback for the SPA. In {@code quarkus:dev} the Quinoa dev proxy (route
 * order 1100) forwards known asset paths to the Angular dev server, but a deep-link HTML navigation
 * (refresh/bookmark of an Angular route like {@code /projects/x}) isn't a known asset, so it falls
 * through the proxy and 404s. This route (order 9000) reroutes such lost HTML navigations to {@code
 * /}, which the dev proxy DOES forward to the dev server's index — the browser URL keeps the deep
 * link, so the Angular router lands on the right page. In a PACKAGED build this isn't needed:
 * Quinoa's own SPA-routing handler serves index.html for deep links.
 *
 * <p>Only GETs that accept {@code text/html}, don't look like a file (no dot in the last segment —
 * so a branch name containing a dot still 404s in dev; the packaged build handles it), and sit
 * outside the backend prefixes ({@code quarkus.quinoa.ignored-path-prefixes} plus {@code /q}) are
 * rerouted. Inert outside dev mode.
 */
@ApplicationScoped
public class DevModeSpaFallbackRoute {

  /** Reroute guard: without it a broken {@code /} would loop this handler forever. */
  private static final String REROUTED = "qits.spa.rerouted";

  @Inject
  @ConfigProperty(name = "quarkus.quinoa.ignored-path-prefixes", defaultValue = "/api")
  List<String> ignoredPrefixes;

  /**
   * Non-{@code /} only for a qits-in-qits daemon (the start script bridges {@code
   * -Dquarkus.http.root-path}): paths seen here are FULL paths, so the index compare, the {@code
   * /q} check, and the reroute target all carry the prefix. The configured Quinoa prefixes are
   * already root-path-aware in application.properties, so they compare full-path as-is.
   */
  @Inject
  @ConfigProperty(name = "quarkus.http.root-path", defaultValue = "/")
  String rootPath;

  private String rootPrefix;

  void init(@Observes Router router) {
    if (LaunchMode.current() != LaunchMode.DEVELOPMENT) {
      return;
    }
    rootPrefix = RootPath.prefix(rootPath);
    // After the Quinoa dev proxy (1100) and REST (1500), but before the static-resources route
    // (10000): a deep-link HTML nav the dev proxy didn't forward gets rerouted to the app index
    // here so the proxy serves the dev server's index rather than letting it 404.
    router.get("/*").order(9000).handler(this::fallback);
  }

  private void fallback(RoutingContext rc) {
    String path = rc.normalizedPath();
    if (Boolean.TRUE.equals(rc.get(REROUTED))
        || (rootPrefix + "/").equals(path)
        || rootPrefix.equals(path)
        || !acceptsHtml(rc)
        || looksLikeFile(path)
        || isBackendPath(path)) {
      rc.next();
      return;
    }
    rc.put(REROUTED, true);
    // reroute() restarts routing on the outermost router, so the target needs the full prefix.
    rc.reroute(rootPrefix + "/");
  }

  private boolean acceptsHtml(RoutingContext rc) {
    String accept = rc.request().getHeader("Accept");
    return accept != null && accept.contains("text/html");
  }

  private boolean looksLikeFile(String path) {
    return path.substring(path.lastIndexOf('/') + 1).contains(".");
  }

  private boolean isBackendPath(String path) {
    if (path.equals(rootPrefix + "/q") || path.startsWith(rootPrefix + "/q/")) {
      return true;
    }
    return ignoredPrefixes.stream().anyMatch(path::startsWith);
  }
}
