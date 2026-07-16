/**
 * Shared core of qits' build-variant auth (docs/features/2026-07-16_build-variant-auth.md). The
 * {@code service} app never carries auth code itself; a Maven profile selected via {@code
 * -Dqits.variant=oauth|forwardauth} adds exactly one variant module, and this module arrives
 * transitively with the always-on {@link eu.wohlben.qits.security.QitsAuthPolicy}, the {@link
 * eu.wohlben.qits.security.PublicPaths} token-free allowlist, and the {@code /api/auth/me}
 * introspection endpoint.
 *
 * <p><b>The variant-module contract</b> — each variant module must:
 *
 * <ul>
 *   <li>define {@code qits.auth.variant=<id>} in its {@code
 *       META-INF/microprofile-config.properties} (shipped config defaults live there too — Quarkus
 *       reads that file from dependency jars, unlike {@code application.properties}). The key is
 *       reported by {@code /api/auth/me} and referenced from a build-time property in the service
 *       app, so a build that skipped variant selection fails augmentation instead of booting
 *       unprotected;
 *   <li>provide exactly one {@code HttpAuthenticationMechanism} (auth-oidc: quarkus-oidc's;
 *       auth-forwardauth: its own header-trusting one);
 *   <li>carry a {@code META-INF/jandex.idx} (the jandex-maven-plugin in the module pom) so its
 *       beans are auto-discovered.
 * </ul>
 */
package eu.wohlben.qits.security;
