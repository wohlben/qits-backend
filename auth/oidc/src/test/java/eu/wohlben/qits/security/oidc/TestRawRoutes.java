package eu.wohlben.qits.security.oidc;

import io.vertx.ext.web.Router;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

/**
 * Test stand-ins for the service app's raw Vert.x router routes (/git host, /daemon proxy):
 * /rawroute must be challenged like any protected path — the regression proof that the global
 * QitsAuthPolicy covers raw router routes, not just JAX-RS — while /git/ping sits on the public
 * list and must stay token-free.
 */
@ApplicationScoped
public class TestRawRoutes {

  void register(@Observes Router router) {
    router.get("/rawroute").handler(context -> context.response().end("raw"));
    router.get("/git/ping").handler(context -> context.response().end("pong"));
  }
}
