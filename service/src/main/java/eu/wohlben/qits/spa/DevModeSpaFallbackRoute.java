package eu.wohlben.qits.spa;

import io.quarkus.runtime.LaunchMode;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Dev-mode history-API fallback for the SPA. Quinoa registers its own SPA-routing handler (route
 * order 40000), but this app also carries quarkus-undertow (for JGit's {@code GitServlet}), whose
 * default servlet route sits at order 10000 and answers every unmatched request with the dev 404
 * page — so in {@code quarkus:dev} a deep-link navigation (refresh, bookmark) never reaches
 * Quinoa's handler. This route slots in between (order 9000): it reroutes lost HTML navigations to
 * {@code /}, which the Quinoa dev proxy forwards to the Angular dev server's index — the browser
 * URL keeps the deep link, so the Angular router lands on the right page.
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

  void init(@Observes Router router) {
    if (LaunchMode.current() != LaunchMode.DEVELOPMENT) {
      return;
    }
    // After the Quinoa dev proxy (1100) and REST (1500), but BEFORE the undertow default servlet
    // route (10000, pulled in by JGit's GitServlet): undertow 404s everything unmatched, so
    // Quinoa's own SPA-routing handler (40000) never runs in this app.
    router.get("/*").order(9000).handler(this::fallback);
  }

  private void fallback(RoutingContext rc) {
    String path = rc.normalizedPath();
    if (Boolean.TRUE.equals(rc.get(REROUTED))
        || "/".equals(path)
        || !acceptsHtml(rc)
        || looksLikeFile(path)
        || isBackendPath(path)) {
      rc.next();
      return;
    }
    rc.put(REROUTED, true);
    rc.reroute("/");
  }

  private boolean acceptsHtml(RoutingContext rc) {
    String accept = rc.request().getHeader("Accept");
    return accept != null && accept.contains("text/html");
  }

  private boolean looksLikeFile(String path) {
    return path.substring(path.lastIndexOf('/') + 1).contains(".");
  }

  private boolean isBackendPath(String path) {
    if (path.equals("/q") || path.startsWith("/q/")) {
      return true;
    }
    return ignoredPrefixes.stream().anyMatch(path::startsWith);
  }
}
