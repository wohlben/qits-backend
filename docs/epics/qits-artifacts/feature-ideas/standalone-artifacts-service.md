# Split artifacts into its own Quarkus server

## Introduction

The [qits-artifacts backbone](../features/2026-07-19_qits-artifacts.md) was deliberately built
**split-deployment-ready**: *all* artifacts code lives in the `artifacts/` library module (no
dependency on `domain` or any `auth/*` module), it owns its **own named datasource + persistence unit
+ Flyway lineage**, and only the thin REST boundary lives in `service`. This draft executes the split
the backbone was shaped for: a **new small Quarkus-app module** that depends on `artifacts` and
hosts the same API paths, so artifacts runs as its **own server** — the same relationship `service`
has to `domain` today. The move is intended to be a **lift-and-wire, not a refactor**.

The immediate motivating payoff: a standalone server gets its **own `quarkus.http.limits.max-body-size`**,
so large media uploads no longer force qits' *shared* HTTP body ceiling up.

Related / dependent plans:

- **Directly resolves**
  [artifacts-global-max-body-size-widens-public-ingest-dos](../../../issues/2026-07-19_artifacts-global-max-body-size-widens-public-ingest-dos.md):
  today artifacts and qits share one HTTP server, and `max-body-size` is a **hard global ceiling on
  every route** (verified — no per-route override, a custom Vert.x route does not bypass it). Raising
  it for large uploads also lifts the wire-size guard the public `/api/capture` and `/api/otel/*`
  ingest endpoints rely on, so the backbone had to *lower* the `ci-videos` cap to 64 MB to keep that
  exposure modest. A separate server severs the coupling cleanly: artifacts sets a large
  `max-body-size` on *its own* HTTP server and restores the `ci-videos` cap to its natural size, while
  qits' `service` keeps the 10 MB default that protects capture/OTLP. This is the preferred full fix
  over the issue's interim per-path-`BodyHandler` idea.
- **Backbone / boundary being lifted** — the store plan's *Design sketch* already names this: "The
  likely future standalone deployable is then a small new Quarkus-app module depending on
  `artifacts` — the same relationship `service` has to `domain` today," and "the module boundary is
  drawn so the likely future split into a separately deployed service is a lift-and-wire, not a
  refactor." The REST paths (`/api/artifacts/…`) were chosen to "map 1:1 onto the standalone
  service's paths after the split."
- **Networking** —
  [qits-net / devcontainer unification](../../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md):
  the split introduces a dedicated **`qits-artifacts`** alias on `qits-net` and its own
  compose/devcontainer service; workspace containers upload to `http://qits-artifacts:<port>/…`
  instead of the `qits` alias. Like the git host, nothing is published to the host.
- **Deployment** — [deployment guide](../../../guides/deployment.md), `docker-compose.prod.yml`, the
  Dokploy overlay: the split adds an artifacts service under the same self-contained-Dockerfile
  discipline (`docs/qits.../Dockerfile` gains an artifacts-app stage), and the guide gains its
  artifacts section. Its own data volume for `~/.qits/data/artifacts` (H2 + blobs).
- **Auth** — [build-variant-auth](../../../epics/qits-authentication/features/2026-07-16_build-variant-auth.md):
  hosting the API in `service` today puts it behind `QitsAuthPolicy` (bypassed via `PublicPaths`,
  writes guarded by the static `qits.artifacts.token`). A standalone server has **no
  `QitsAuthPolicy`** — the static token becomes the *whole* auth story on its own surface, so the
  `PublicPaths` entries in `auth-core` are removed once nothing hosts artifacts in `service`. The
  scoped-token direction (`docs/epics/qits-tokens/`, if pursued) is the later hardening.

## Motivation

Artifacts and qits have genuinely different HTTP profiles. qits' API is small JSON over a same-origin
SPA, with two public unauthenticated ingest endpoints (capture, OTLP) that must stay wire-size-bounded.
Artifacts is a blob server that streams large media. Forcing both through one Quarkus HTTP server
means one `max-body-size` must serve both — and the safe value for one is the wrong value for the other.
That single shared knob is the concrete pain the backbone already had to compromise on (the 64 MB
`ci-videos` cap). Everything else about artifacts is *already* separate (module, datasource, Flyway,
error hierarchy, config namespace); only the HTTP host is shared. Splitting the host is the last step of
a separation the backbone all but finished.

The split is also the point at which "artifacts is its own deployable" stops being a design claim and
becomes true — de-risking the eventual maven/npm/docker protocol repositories, whose clients
(`mvn`/`npm`/`docker`) expect a registry at its own host:port, not a sub-path of qits.

## Sketch of the work

- **New module `artifacts-service/`** (Quarkus app, `<packaging>quarkus</packaging>`) depending on
  `artifacts` + `quarkus-rest-jackson` + `quarkus-vertx-http`. It **moves** (not copies) the boundary
  classes out of `service`'s `eu.wohlben.qits.artifacts.api` package: `BlobController`,
  `RepositoryController`, `ArtifactsExceptionMapper`, `ArtifactsTokenFilter`,
  `ArtifactsStartupSeed`. Its `application.properties` sets a large `max-body-size`, the artifacts
  datasource/PU/Flyway (or inherits them from the jar's `microprofile-config.properties`), and
  `quarkus.http.port`.
- **`service` drops the artifacts dependency**, its `quarkus.index-dependency.artifacts.*`, the
  `max-body-size` bump, and the `/api/artifacts` `PublicPaths` entries. `RepositoryType.maxBytes` for
  `ci-videos` returns to a natural size once the shared ceiling is gone.
- **Producers/consumers re-point** from the `qits` alias to `qits-artifacts` (the `QitsHostResolver`
  gains an artifacts host, or a dedicated resolver). The future diff UI calls the artifacts host
  directly.
- **Compose/Dokploy**: a new `qits-artifacts` service + a data volume; the guide documents it.

## Open questions

- **CORS / same-origin.** With artifacts on a different origin than the qits SPA, the future diff
  UI's `<img src="http://qits-artifacts/…">` is cross-origin. Serve responses may need permissive
  CORS (they are public, immutable, content-addressed blobs — low risk), mirroring the capture route's
  surgical CORS precedent.
- **One deployable or two by default?** For small/self-hosted installs, running a second server is
  overhead. Options: ship both a combined dev mode (artifacts boundary still hostable in `service`
  behind a profile) and the split prod topology; or commit fully to two servers. The backbone leaned
  "a second deployable is overhead the current scale doesn't justify" — this draft is the trigger to
  revisit that once the max-body-size pain (or a protocol repository) makes the second server worth it.
- **Shared vs separate `~/.qits/data/artifacts`.** In-process today both qits and the (hypothetical)
  split write the same path; as separate containers they need the volume mounted into the artifacts
  service only. Trivial, but note it so the blobs/H2 don't get orphaned on the qits container.
- **Trigger.** Not worth building until one of: the 64 MB `ci-videos` compromise actually bites; the
  first protocol repository (maven/npm/docker) lands, whose clients want a real host:port; or the
  capture/OTLP exposure must be driven back to the 10 MB default for a security posture.
