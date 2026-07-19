# qits-artifactory: a blob-storage microservice for build artifacts

## Introduction

qits grows a **split-off artifactory**: `qits-artifactory`, a metadata-rich blob storage for
build artifacts. The scope of this feature is the **blob storage itself** — an artifactory core
that stores immutable blobs with a free-form metadata map and answers metadata queries, living
in **its own Maven module** (explicitly *not* in `domain` — persistence, entities, control all
stay out of the shared core, because this will likely be deployed separately in the future)
with its REST API hosted, **for now, by the main `service` module** — plus its first two
concrete repositories, **`ci-screenshots`** and **`ci-videos`**. Their purpose: keep "**golden** screenshots/videos **by branch**" so a change
can be *diffed visually* — e.g. a complex user interaction flow defined as a Playwright test
produces a video/screenshots on both the parent branch and the current workspace branch, and the
two can later be shown side-by-side to highlight what changed. (The side-by-side UI is
explicitly **out of scope** here; this feature builds the store that makes it possible.)

Protocol-shaped repositories — **maven, npm, docker** — are deliberately **deferred**: they need
protocol emulation (maven layout paths, the npm registry API, the docker registry v2 API), which
is a different order of work than a metadata profile over a generic blob core. **Upon completion
of this feature, three follow-up epics must be created**, each referencing this epic as its
backbone: `qits-artifactory-maven-repository`, `qits-artifactory-npm-repository`,
`qits-artifactory-docker-repository` (see Follow-ups).

Related/dependent plans:

- **Sibling of the in-monolith artifact store** —
  [capture-rendered-view-screenshot](../../qits-feature-intake/feature-ideas/capture-rendered-view-screenshot.md)'s
  `CaptureArtifactStore` keeps capture PNGs on qits' own disk, keyed by workspace. That store
  stays as-is (a capture is workspace-lifecycle-bound, not a branch-keyed golden); artifactory
  is the service-shaped generalization for artifacts that must **outlive** any single workspace
  and be queryable across branches. Migrating captures onto artifactory is a possible later
  consolidation, not part of this feature.
- **The golden-pixels precedent** —
  [screenshot-baseline-renderer-baked-into-image](../../qits-build-setup/features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md)
  (and the drift issues it resolved) established that comparable pixels require a pinned
  renderer. The same discipline applies to artifactory goldens: a branch-vs-branch diff is only
  meaningful when both sides were produced by the same renderer image — worth a metadata key
  (below) rather than an assumption. qits' own committed visual baselines are a potential later
  consumer (per-branch goldens instead of committed PNGs), out of scope here.
- **Producers run in workspace containers** —
  [workspace-containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md) /
  [actions](../../qits-feature-flows/features/2026-05-01_actions.md) /
  [feature-flows](../../qits-feature-flows/features/2026-05-01_feature-flows.md): the natural uploader is an action
  script (a Playwright run) inside a workspace container — concretely, the
  [qits-userflows](../../qits-userflows/feature-ideas/qits-userflows.md) report output, whose sidecar carries exactly this
  metadata. Reachability rides
  [qits-net](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md): with the API hosted
  on qits, containers upload through the existing `qits` alias; a dedicated `qits-artifactory`
  alias arrives only with the future deployment split — either way, no host-port publishing.
- **Deployment** — [deployment guide](../../../guides/deployment.md): nothing changes on day one (the
  API ships inside the qits app); the future split adds an artifactory service to
  `docker-compose.prod.yml` / the Dokploy overlay under the same self-contained-Dockerfile
  discipline, and the guide gains its artifactory section when that happens.
- **Auth** — [build-variant-auth](../../qits-authentication/features/2026-07-16_build-variant-auth.md): hosting the API
  in `service` puts it behind the always-on `QitsAuthPolicy`, but upload clients are CI
  processes in containers holding no session — the write surface needs `PublicPaths` entries or
  per-repository tokens (see Open questions). The artifactory *module* itself carries no auth
  code either way, same as `domain`.

## Motivation: goldens by branch

Today a visual regression is invisible until a human notices it. The pieces to make it visible
already exist in qits-managed repos: workspaces are branches, actions run real test commands in
containers, and Playwright can record a defined user flow as screenshots and video. What is
missing is a place to **put** those recordings such that:

1. the recording from the **parent branch** (the golden) is still there when the workspace
   branch produces its own,
2. both can be **found** by what they depict — branch, commit, and *which user flow* — rather
   than by file path inside a long-gone container,
3. a future diff UI can ask "give me the latest `checkout-flow` video for `main` and for
   `feature/x`" and get two URLs to render side-by-side.

That is a metadata-query problem over immutable blobs — not a file server, not a git LFS, and
not (yet) a package registry. Hence: a generic blob core with typed repositories, shipping first
with the two media repositories that serve the diffing loop.

## Contract

1. **Its own module, split-deployment-ready.** `qits-artifactory` is its own Maven module
   holding *all* artifactory code — entities, persistence, control, validation. **None of it
   lives in `domain`**, and the module depends on neither `domain` nor any `auth/*` module — no
   knowledge of qits' entities; blobs reference branches and flows by *string metadata*, not by
   foreign key. The REST **API is, for now, registered in the main `service` module** (thin
   boundary controllers over the module's services) — a second deployable is overhead the
   current scale doesn't justify — but the module boundary is drawn so the likely future split
   into a separately deployed service is a lift-and-wire, not a refactor: artifactory must not
   break when qits' schema moves.
2. **Blobs are immutable and content-addressed.** A blob's id is the SHA-256 of its bytes;
   uploading identical bytes twice stores them once (metadata records stay distinct — two
   branches may legitimately produce pixel-identical goldens, and each keeps its own metadata
   row pointing at the shared content). There is no update or overwrite; "the new golden" is a
   newer record, resolved by query.
3. **Metadata is a flat string map per upload**, with a small set of well-known keys (table
   below). The store validates what the repository type requires and stores the rest opaquely —
   unknown keys are legal and queryable, so producers can enrich without a service release.
4. **Repositories are named, typed containers.** A repository has a name and a **type** that
   defines its validation profile: which media types are accepted and which metadata keys are
   required. This feature ships two types:
   - **`ci-screenshots`** — accepts `image/png`, `image/jpeg`, `image/svg+xml`; requires the
     git, userflow, display-name and diff-hash keys plus `media.resolution.width`/`height`.
   - **`ci-videos`** — accepts `video/mp4`, `video/webm`; requires the same plus
     `media.resolution.length` (duration).
   The type is a validation/convention profile over the shared core — deliberately thin, so the
   deferred protocol types (maven/npm/docker) slot in as new types without touching the core.
5. **Query answers the golden question.** The read API must support: filter by repository +
   exact-match metadata predicates, ordered by creation date, with a "latest only" collapse —
   so "latest per (`git.branch.name`, `qits.userflow.name`)" is one request per branch. Nothing
   fancier (no full-text, no ranges) in iteration one.
6. **Serving is by blob id** with the stored `mediatype` as `Content-Type` and
   `Cache-Control: immutable` (content-addressed ids never change meaning) — directly usable as
   an `<img>`/`<video>` src by the future diff UI.
7. **The diff/side-by-side UI is out of scope.** So are retention/GC policies beyond "keep
   everything" (see Open questions), and the three protocol repository types.

## Well-known metadata keys

| Key | Meaning | Set by |
|---|---|---|
| `mediatype` | The blob's media type (`image/png`, `image/svg+xml`, `video/mp4`, …); maps to the upload's `Content-Type` header and is echoed as the download's | uploader (header), sniff-verified |
| `git.branch.name` | Branch the artifact was produced from | uploader |
| `git.commit.hash` | Commit the artifact was produced from | uploader |
| `qits.userflow.name` | Logical name of the recorded user flow (e.g. the Playwright test id) | uploader |
| `qits.userflow.hash` | Hash of the flow *definition* — two recordings compare like-for-like only when their flow hashes match (a changed test is a changed yardstick, and the diff UI must be able to say so) | uploader |
| `qits.display.name` | Human-readable title of the element *within* a flow (e.g. "step 3: cart") — the label the diff UI shows, and half of its pairing key alongside `qits.userflow.name` | uploader, **mandatory** for both CI types |
| `qits.diff.hash` | Opaque comparison hash: equal ⇒ the element is *unchanged* between two recordings. Content-derived for images; for videos deliberately **not** the file hash (bytes differ across identical runs) — the video hashing scheme is the uploader's concern and out of scope for now. The store and the diff evaluation only ever compare it as a string | uploader, **mandatory** for both CI types |
| `media.resolution.width` / `media.resolution.height` | Pixel dimensions | uploader; server-verified for images where cheap |
| `media.resolution.length` | Video duration (seconds) | uploader |
| `created-at` | Upload timestamp | **server-stamped**, never trusted from the wire |
| `renderer.image` | The renderer/toolchain image tag that produced the pixels (see the baseline-renderer precedent) | uploader, optional but recommended |

## Design sketch

- **Module shape**: a new top-level Maven module `artifactory/` in the qits reactor — a plain
  library jar like `domain` (`eu.wohlben.qits.artifactory` with `entity/`, `persistence/`,
  `control/`, `mapper/`, `dto/`), sharing the parent pom's toolchain (JDK 25, Spotless, build
  cache), bean-indexed for its consumer the way the auth modules are. `service` adds it as a
  dependency and hosts the boundary: thin controllers in `eu.wohlben.qits.artifactory.api`,
  the same BCE split the domain areas use. Module-scoped builds (`-pl artifactory`) never need
  the `-Dqits.variant` flag. The likely future standalone deployable is then a small new
  Quarkus-app module depending on `artifactory` — the same relationship `service` has to
  `domain` today.
- **Storage**: blob bytes on disk under `${user.home}/.qits/data/artifactory/blobs/<sha256[0:2]>/<sha256>`
  (fan-out dirs, write-to-temp + atomic rename); metadata + repository rows in artifactory's
  **own named datasource** — a separate file-based H2 (`~/.qits/data/artifactory/h2/…`) with its
  **own Flyway lineage**. Even while in-process, artifactory never shares qits' DB or migration
  history, so the future split moves files, not data. Content file and metadata row are
  decoupled exactly as the content-addressing contract implies.
- **API** (all under `/api/artifactory` — the prefix keeps it clear of qits' existing
  `/api/repositories/{repoId}` area while the API shares the `service` surface, and maps 1:1
  onto the standalone service's paths after the split):
  - `POST /api/artifactory/repositories/{repo}/blobs` — raw body upload; `Content-Type` supplies
    `mediatype`, metadata rides `X-Artifactory-Meta-<key>` headers (flat strings map cleanly to
    headers and keep the body a pure byte stream for large videos — no multipart parsing).
    Server sniffs magic bytes (sniffed type wins over the claimed header, same policy as the
    capture ingest), enforces the repository type's profile and a per-type size cap, stamps
    `created-at`, and returns `{id, existing}` (whether the bytes deduped).
  - `GET /api/artifactory/repositories/{repo}/blobs/{id}` — bytes, stored mediatype, immutable
    caching.
  - `GET /api/artifactory/repositories/{repo}/blobs?meta.git.branch.name=main&meta.qits.userflow.name=checkout&latest=true`
    — metadata records (id, all keys, size), newest-first; `latest=true` collapses to the
    newest per (`git.branch.name`, `qits.userflow.name`) group.
  - `PUT /api/artifactory/repositories/{repo}` — create/ensure a repository with a type
    (`{"type": "ci-screenshots"}`); listing endpoints to match.
- **Network + addressing**: nothing new — the API rides qits' existing `qits-net` presence, so
  an action script uploads to `http://qits:8080/api/artifactory/…`, the same
  `QitsHostResolver` address containers already use for git/OTLP/MCP. The future split
  introduces the `qits-artifactory` alias and its own compose/devcontainer service; like the
  git host, nothing is ever published to the host.
- **Producer convention (documentation, not code)**: a worked example in the doc/guide showing a
  Playwright action script that runs a flow, then curls its `test-results/` screenshots + video
  up with the metadata keys derived from `git rev-parse`/`git branch --show-current` and the
  spec file's content hash as `qits.userflow.hash`. qits itself ships no uploader in this
  feature — the HTTP surface is the product.

## Follow-ups (create after initial implementation)

To be written as their own `docs/epics/` epics once this lands (each referencing this epic as
its backbone from `epic.md`), each a new repository **type** over the same core:

1. `qits-artifactory-maven-repository` — maven layout GET/PUT paths, so workspace builds can resolve
   and deploy through artifactory (build cache/proxy questions live there).
2. `qits-artifactory-npm-repository` — npm registry API subset (publish + install).
3. `qits-artifactory-docker-repository` — docker registry v2 API, the heaviest (chunked uploads,
   manifests referencing blobs — though content-addressed storage is exactly what it wants).

Already drafted downstream: the
[qits-userflows-artifactory-renderer](../../qits-userflows/feature-ideas/qits-userflows-artifactory-renderer.md) adds a third,
still-simple type — **`ci-userstories`**, `text/markdown` story documents whose media
references point back at `ci-screenshots`/`ci-videos` blobs — the first proof that types slot
in without core changes. And the **side-by-side golden diff UI** — the consumer this store
exists for — is drafted as
[qits-artifactory-workspace-userflow-diff-tab](../../qits-userflows/feature-ideas/qits-artifactory-workspace-userflow-diff-tab.md),
comparing the `ci-userstories` documents story-by-story (it is what makes
`qits.display.name`/`qits.diff.hash` mandatory above). Also downstream, but not mandated:
pointing qits' own visual-baseline suite at a `ci-screenshots` repository.

## Open questions

- **Trust model for uploads.** With the API on qits' surface, `QitsAuthPolicy` guards it by
  default — but CI uploaders in workspace containers hold no session. The write path therefore
  needs either `PublicPaths` entries (the `/api/capture` precedent — fine on `qits-net`, but on
  a Traefik-exposed deployment that makes uploads internet-open) or per-repository write
  tokens. Leaning tokens from day one; decide before implementation, and definitely before the
  maven/npm follow-ups, whose clients have real credential plumbing anyway.
- **Retention.** Content addressing makes storage growth append-only; goldens for deleted
  branches never expire on their own. "Keep everything" is fine at current scale — but the
  videos repository will force the question first; a `latest`-per-group keep policy per
  repository type is the likely shape.
- **Who ensures the repositories exist?** Explicit `PUT` by an operator/action vs. qits
  self-seeding `ci-screenshots`/`ci-videos` at startup (the
  [startup-self-seed](../../qits-live-deployment/features/2026-07-19_startup-qits-self-seed.md) pattern). Leaning explicit-create for the
  standalone service, with the worked example including the idempotent `PUT`.
- **H2 vs metadata-in-files.** H2 keeps query flexibility and matches the house stack; if the
  service is ever to be trivially horizontally scalable, filesystem-only metadata would be
  reconsidered — not a current requirement.

## Testing sketch

Suites split with the modules: the store/query/profile tests live in `artifactory`'s own test
suite (in-memory H2, no docker, no variant flag); the boundary tests live in `service`'s.

- Core: upload → dedupe on identical bytes (two records, one file, `existing=true`); metadata
  roundtrip incl. unknown keys; magic-byte sniff overrides a lying `Content-Type`; type profile
  rejects a disallowed mediatype / missing required key with a clear 400; per-type size cap.
- Query: exact-match predicates compose; `latest=true` collapses per branch+flow group; newest
  wins by server-stamped `created-at`.
- Serving: byte-equal roundtrip, stored mediatype as Content-Type, immutable cache header,
  404 on unknown id and on id-shape violations (path-traversal defense on the fan-out dirs).
- Repository lifecycle: ensure-PUT is idempotent; uploads to an unknown repository → 404.
- One end-to-end acceptance walk (manual-acceptance-tests): from a workspace container on
  `qits-net`, an action script uploads a real Playwright screenshot + video with the metadata
  convention through the `qits` alias, and the golden query returns both.
