package eu.wohlben.qits.spa;

import io.quarkus.vertx.http.runtime.filters.Filters;
import io.vertx.core.http.HttpHeaders;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

/**
 * Serves every HTML response with {@code Cache-Control: no-cache} so a redeploy is visible on the
 * next plain page load. Quarkus's static serving stamps its default {@code public, immutable,
 * max-age=86400} on everything — right for the content-hashed Angular bundles (a new build means
 * new URLs), but on the SPA shell ({@code index.html}, also served for every SPA deep link) {@code
 * immutable} tells browsers not even to revalidate for a day, so users keep running the old
 * frontend after a deploy until a cache-bypassing hard refresh
 * (docs/issues/2026-07-17_spa-shell-cached-immutable-deploys-invisible.md). {@code no-cache} still
 * allows conditional revalidation (the shell is ~1 KB; a 304 when unchanged), it just forbids
 * serving it blind from cache.
 *
 * <p>Implemented as a global filter tweaking headers at headers-end rather than a route: the shell
 * is served by Quinoa's SPA handling on arbitrary deep-link paths, so matching by response
 * content-type is the only reliable seam. Non-HTML responses (API JSON, assets, git, OTLP) are
 * untouched.
 */
@ApplicationScoped
public class SpaShellCacheFilter {

  void register(@Observes Filters filters) {
    filters.register(
        rc -> {
          rc.addHeadersEndHandler(
              v -> {
                if (isHtml(rc.response().headers().get(HttpHeaders.CONTENT_TYPE))) {
                  rc.response().headers().set(HttpHeaders.CACHE_CONTROL, "no-cache");
                }
              });
          rc.next();
        },
        100);
  }

  /** True for any {@code text/html} content type, with or without charset parameters. */
  static boolean isHtml(String contentType) {
    return contentType != null && contentType.regionMatches(true, 0, "text/html", 0, 9);
  }
}
