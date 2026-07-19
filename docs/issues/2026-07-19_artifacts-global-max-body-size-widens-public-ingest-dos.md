# Artifacts's global max-body-size raise widens the public capture/OTLP ingest DoS surface

## Introduction

Introduced by [qits-artifacts](../epics/qits-artifacts/features/2026-07-19_qits-artifacts.md).
Related: [capture-ingest-workspace](../epics/qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md)
(whose wire-size guard this weakens), [observability](../epics/qits-observability/features/2026-07-04_observability.md)
(the OTLP receiver), [build-variant-auth](../epics/qits-authentication/features/2026-07-16_build-variant-auth.md)
(`PublicPaths`).

## Status: mitigated, not fully resolved

The blast radius has been cut but the coupling is not eliminated. See "Mitigation applied" and "Full
fix (pending)".

## Observed

Artifacts must accept media uploads larger than Quarkus' 10 MB default `max-body-size`. That
setting is a **hard global ceiling — it gates every route**. Two things were verified empirically:

- A streamed `InputStream` upload is `413`'d at the HTTP layer once the body exceeds the limit (so
  streaming does not sidestep it), and
- a **custom Vert.x route with its own `BodyHandler` does NOT bypass it either** (an 11 MB upload is
  rejected at a 10 MB global limit, accepted at 50 MB) — i.e. the `GitHostRoutes` "large pushes"
  pattern only works because dev/fixture pushes happen to be small; it too is capped by the global
  limit.

Consequently the only way to accept large artifacts uploads is to raise the **global** limit, which
also lifts the wire-size guard on the public, unauthenticated `POST /api/capture` and `POST
/api/otel/v1/*` endpoints (both read the body as a fully-buffered `byte[]`). On the Traefik-exposed
`oauth` prod deployment those are internet-reachable, so a large body buffers into heap before any
application-level cap runs.

## Mitigation applied (2026-07-19)

- The global limit is set to **64 MB** (not the originally-committed 1024 MB), and the `ci-videos`
  type cap is **reduced to 64 MB** to match. A golden UI-flow clip (a short, compressed webm/mp4) is
  well under this, so the feature is unaffected, while the public endpoints are exposed to a ~6× lift
  over the 10 MB default instead of ~100×.
- The upload stays a JAX-RS `InputStream` resource (`BlobController.upload`), which streams to disk
  incrementally — it does not buffer the whole body in memory (unlike a `BodyHandler`), so artifacts
  itself doesn't add a large-buffer DoS.

## Full fix (pending)

Decouple the public ingest paths from the global limit with a **per-path low-limit `BodyHandler`** on
`/api/capture` and `/api/otel/*` (a `BodyHandler` can enforce a limit *below* the global ceiling on a
specific route, the inverse of the raise-per-route that fails above), then the global limit can be
raised freely for artifacts without exposing capture/OTLP. Deferred because it modifies the request
handling of endpoints owned by other features (capture, telemetry) and wants their own regression
coverage; it is out of the artifacts feature's scope.

## Regression test to add with the full fix

A `@QuarkusTest` posting a body larger than the per-path cap to `/api/capture` expects `413`, while an
artifacts upload of the same size succeeds — proving the limits are decoupled.
