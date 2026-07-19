# qits-artifactory: a metadata-rich blob store for build artifacts

## Introduction

qits grows a **split-off artifactory**: a metadata-rich blob store for build artifacts, in its
**own Maven module** `artifactory/` (explicitly *not* in `domain` — persistence, entities, control
all stay out of the shared core, because this will likely be deployed separately) with its REST API
hosted, **for now, by the main `service` module**. It stores immutable, content-addressed blobs with
a free-form metadata map and answers metadata queries, shipping with its first two concrete
repository types, **`ci-screenshots`** and **`ci-videos`** — keeping "**golden** screenshots/videos
**by branch**" so a change can be *diffed visually* later. The side-by-side diff UI and the
protocol-shaped types (maven/npm/docker) remain out of scope (see Follow-ups).

Related/dependent plans:

- **Sibling of the in-monolith capture store** —
  [capture-ingest-workspace](../../qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md)'s ingest
  keeps a capture as workspace-lifecycle-bound goal text; artifactory is the service-shaped
  generalization for artifacts that must **outlive** any single workspace and be queryable across
  branches. Its raw-body upload + magic-byte-sniff stance (sniffed type wins over the claimed header)
  is the precedent this feature mirrors.
- **The golden-pixels precedent** —
  [screenshot-baseline-renderer-baked-into-image](../../qits-build-setup/features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md):
  a branch-vs-branch diff is only meaningful when both sides were produced by the same renderer image
  — captured here as the optional `renderer.image` metadata key.
- **Producers run in workspace containers** —
  [workspace-containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md) /
  [actions](../../qits-feature-flows/features/2026-05-01_actions.md): the natural uploader is a Playwright
  action script inside a workspace container. Reachability rides
  [qits-net](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md): containers upload
  through the existing `qits` alias; no host-port publishing.
- **First consumer** — the [qits-userflows epic](../../qits-userflows/epic.md): user-story runs upload
  their goldens here; its renderer part contributes the `ci-userstories` type (first proof types slot
  in without core changes) and its diff tab is the read-side consumer this store's query was shaped
  for.
- **Auth** — [build-variant-auth](../../qits-authentication/features/2026-07-16_build-variant-auth.md): the API sits
  behind the always-on `QitsAuthPolicy`; the write surface is protected by a static system token (see
  below), and the paths are on `auth-core`'s token-free `PublicPaths` allowlist.

## What was built

### A new library-jar module `artifactory/`

A plain library jar like `domain` (`eu.wohlben.qits.artifactory`, BCE split `entity/ persistence/
control/ mapper/ dto/` + a framework-free `error/`), depending on neither `domain` nor any `auth/*`
module — no knowledge of qits' entities; blobs reference branches and flows by *string metadata*,
never by foreign key. `service` adds it as a dependency, indexes it
(`quarkus.index-dependency.artifactory.*`), and hosts the boundary in `eu.wohlben.qits.artifactory.api`.
Module-scoped builds (`-pl artifactory`) never need the `-Dqits.variant` flag. The future standalone
deployable is a small new Quarkus-app module depending on `artifactory` — the same relationship
`service` has to `domain`.

### Own datasource, own Flyway lineage (split-deployment-ready)

Artifactory persists to its **own named datasource** — a separate file-based H2
(`~/.qits/data/artifactory/h2/artifactory`) with a **dedicated Hibernate persistence unit** and its
**own Flyway lineage** (`classpath:db/artifactory/migration`, kept clear of `domain`'s
`db/migration`). Even while in-process, artifactory never shares qits' DB or migration history, so
the future split moves files, not data. These defaults ship in the module's
`META-INF/microprofile-config.properties` (read from the dependency jar, the `auth/*` pattern); the
consumer pins domain's entities to the default unit
(`quarkus.hibernate-orm.packages=eu.wohlben.qits.domain`).

### Content-addressed, immutable blobs

A blob's id is the **SHA-256 of its bytes** (`BlobStore`): bytes live at
`<blobs-dir>/<sha[0:2]>/<sha>` (fan-out dirs), staged to a temp file — **hashing + counting + the
per-type cap enforced while streaming**, so a large video never materialises in memory — then
atomically renamed into place. Uploading identical bytes twice stores them once (`existing=true`),
while each upload still records its own distinct metadata row (two branches may legitimately produce
pixel-identical goldens). Serving validates the id against `^[0-9a-f]{64}$` **before** touching the
filesystem (path-traversal defence).

### Typed repositories = validation profiles

A repository is a named container with a **type** (`RepositoryType`) that defines its profile:
accepted media types, required metadata keys, and a per-upload size cap.

- **`ci-screenshots`** — accepts `image/png`, `image/jpeg`, `image/svg+xml`; requires
  `git.branch.name`, `git.commit.hash`, `qits.userflow.name`, `qits.userflow.hash`,
  `qits.display.name`, `qits.diff.hash`, `media.resolution.width`/`height`; ~25 MB cap.
- **`ci-videos`** — accepts `video/mp4`, `video/webm`; requires the same **minus** width/height
  **plus** `media.resolution.length`; 64 MB cap (sized to the global HTTP body ceiling — see the
  upload note below).

On upload the server sniffs magic bytes (`MediaTypeSniffer`: PNG/JPEG/MP4/WebM signatures, SVG as XML
text) and the **sniffed type wins** over the claimed `Content-Type`; it enforces the profile (a
disallowed media type or a missing required key → clear 400), server-stamps `created-at` (never
trusted from the wire), and — for PNG, where it's cheap — cross-checks the IHDR dimensions against
the supplied `media.resolution.*`.

### API (all under `/api/artifactory`, hidden from OpenAPI)

The boundary is a wire/system API, marked `@Operation(hidden = true)` so `docs/openapi.yml` and the
generated Angular client stay untouched (the capture/OTLP precedent).

- `PUT /api/artifactory/repositories/{repo}` — idempotently create/ensure a repository with a type
  (`{"type": "ci-screenshots"}`). Also self-seeded at startup (below).
- `GET /api/artifactory/repositories` — list.
- `POST /api/artifactory/repositories/{repo}/blobs` — raw body upload; `Content-Type` supplies the
  claimed media type, metadata rides `X-Artifactory-Meta-<key>` headers. Returns `201 {id, existing}`
  (`id` = the content SHA-256). The body is injected as a JAX-RS `InputStream` and streamed to disk
  incrementally (no whole-video buffer). The wire size is bounded by `quarkus.http.limits.max-body-size`
  — a **hard global ceiling on every route** — raised to 64 MB (= the `ci-videos` cap) to admit media;
  the tradeoff of that global raise for the public capture/OTLP endpoints, and its pending full fix,
  are tracked in `docs/issues/2026-07-19_artifactory-global-max-body-size-widens-public-ingest-dos.md`.
- `GET /api/artifactory/repositories/{repo}/blobs/{id}` — bytes, stored media type as `Content-Type`,
  `Cache-Control: public, max-age=31536000, immutable`. Directly usable as an `<img>`/`<video>` src.
- `GET /api/artifactory/repositories/{repo}/blobs?meta.<key>=<v>&latest=true` — metadata records,
  newest-first; `latest=true` collapses to the newest per (`git.branch.name`, `qits.userflow.name`)
  group — so "latest per branch for this flow" is one request.

### Well-known metadata keys

`mediatype` (server-controlled, sniffed) · `git.branch.name` · `git.commit.hash` ·
`qits.userflow.name` · `qits.userflow.hash` · `qits.display.name` (mandatory, both CI types) ·
`qits.diff.hash` (mandatory, both CI types) · `media.resolution.width`/`height`/`length` ·
`created-at` (**server-stamped**, wire value discarded) · `renderer.image` (optional). Unknown keys
are legal, stored opaquely, and queryable — producers enrich without a service release.

## Resolved open questions

- **Trust model for uploads** → a **single static API token** (`qits.artifactory.token`), checked on
  writes (POST/PUT) via the `X-Artifactory-Token` header by `ArtifactoryTokenFilter` in `service`.
  This is a pure system API; the token is set from an application property / env in a deployment.
  When the token is **blank** (the dev/test default) the guard is a no-op, keeping dev and the suites
  friction-free. **Reads (serve + query) are always open** — a blob must be usable directly as an
  `<img>`/`<video>` src, and the query rides qits-net. The paths are on `auth-core`'s `PublicPaths`
  allowlist (their callers are CI processes holding no session).
- **Who ensures the repositories exist?** → **startup self-seed**. `ArtifactoryStartupSeed` (in
  `service`, mirroring `StartupSelfSeed`) idempotently ensures `ci-screenshots` and `ci-videos` at
  boot in `NORMAL`/`DEVELOPMENT` launch modes (never `TEST`). The `PUT` lifecycle endpoint still
  exists for any others.
- **Retention** → "keep everything" for now; content addressing makes storage append-only. A
  `latest`-per-group keep policy per repository type is the likely later shape (backlog).
- **H2 vs metadata-in-files** → H2, for query flexibility and house-stack consistency.

## Producer convention (worked example)

qits ships no uploader — the HTTP surface is the product. A Playwright action script running in a
workspace container uploads its recordings through the `qits` alias on qits-net:

```bash
#!/usr/bin/env bash
set -euo pipefail
BRANCH="$(git branch --show-current)"
COMMIT="$(git rev-parse HEAD)"
FLOW="checkout"                                   # the Playwright test id
FLOW_HASH="$(sha256sum tests/checkout.spec.ts | cut -d' ' -f1)"   # the yardstick
ART="http://qits:8080/api/artifactory"           # the qits-net alias; no host-port publishing
TOKEN_HEADER=(-H "X-Artifactory-Token: ${QITS_ARTIFACTORY_TOKEN}")  # omit when unset (dev)

npx playwright test tests/checkout.spec.ts        # writes test-results/…/*.png and *.webm

# A screenshot (dimensions from the file; here a known 1440x900 capture)
curl -fsS -X POST "${ART}/repositories/ci-screenshots/blobs" "${TOKEN_HEADER[@]}" \
  -H "Content-Type: image/png" \
  -H "X-Artifactory-Meta-git.branch.name: ${BRANCH}" \
  -H "X-Artifactory-Meta-git.commit.hash: ${COMMIT}" \
  -H "X-Artifactory-Meta-qits.userflow.name: ${FLOW}" \
  -H "X-Artifactory-Meta-qits.userflow.hash: ${FLOW_HASH}" \
  -H "X-Artifactory-Meta-qits.display.name: step 3 — cart" \
  -H "X-Artifactory-Meta-qits.diff.hash: $(sha256sum step3.png | cut -d' ' -f1)" \
  -H "X-Artifactory-Meta-media.resolution.width: 1440" \
  -H "X-Artifactory-Meta-media.resolution.height: 900" \
  --data-binary @step3.png

# The video (length in seconds; diff.hash is the uploader's scheme, not the file hash)
curl -fsS -X POST "${ART}/repositories/ci-videos/blobs" "${TOKEN_HEADER[@]}" \
  -H "Content-Type: video/webm" \
  -H "X-Artifactory-Meta-git.branch.name: ${BRANCH}" \
  -H "X-Artifactory-Meta-git.commit.hash: ${COMMIT}" \
  -H "X-Artifactory-Meta-qits.userflow.name: ${FLOW}" \
  -H "X-Artifactory-Meta-qits.userflow.hash: ${FLOW_HASH}" \
  -H "X-Artifactory-Meta-qits.display.name: full run" \
  -H "X-Artifactory-Meta-qits.diff.hash: ${FLOW_HASH}-${BRANCH}" \
  -H "X-Artifactory-Meta-media.resolution.length: 12" \
  --data-binary @run.webm
```

The golden query for the diff UI is then, per branch:
`GET /api/artifactory/repositories/ci-screenshots/blobs?meta.git.branch.name=main&meta.qits.userflow.name=checkout&latest=true`.

## Testing

- **`artifactory` suite** (in-memory H2, no docker, no variant flag): upload → dedupe on identical
  bytes (two records, one file, `existing=true`); metadata roundtrip incl. unknown keys + discarded
  wire `created-at`; magic-byte sniff overrides a lying `Content-Type`; profile rejects a disallowed
  media type / a missing required key (400); PNG dimension mismatch (400); per-type size cap (413);
  query predicate AND-composition, `latest` collapse per branch+flow, newest-wins; blob store atomic
  roundtrip + id-shape/path-traversal defence; media-type sniffer per format.
- **`service` suite** (`@QuarkusTest`): upload/serve/query HTTP round-trip (201, exact bytes, stored
  Content-Type, immutable cache header), 404 on unknown repo / unknown or malformed id, sniff override
  end-to-end, ensure-PUT idempotency + type-change rejection; the static-token guard (401 without/with
  a wrong token, 200 with it, serve stays open); `PublicPaths` includes `/api/artifactory/`.

## Follow-ups (create as their own epics)

Each a new repository **type** over the same core, referencing this epic as backbone:
`qits-artifactory-maven-repository`, `qits-artifactory-npm-repository`,
`qits-artifactory-docker-repository` (stub epics created alongside this feature). Already drafted
downstream: the `ci-userstories` type and the side-by-side golden diff UI, both in the
[qits-userflows epic](../../qits-userflows/epic.md).
