# qits-userflows-artifacts-renderer: publish user-story reports into the artifacts

## Introduction

The piece that finally combines the [qits-artifacts](../../qits-artifacts/feature-ideas/qits-artifacts.md) and
[qits-userflows](qits-userflows.md) plans: a **second renderer** over the userflows module's
canonical `userflow.json` output. Where the default renderer writes a local markdown bundle
into `target/userstories/`, this renderer **publishes**: it first uploads the story's
screenshots and video to their artifacts repositories (obtaining content-addressed blob
URLs), then re-renders the story markdown *against those uploaded URLs*, and finally stores
the story document itself as a blob — which requires **extending artifacts with a third
repository type**, `ci-userstories`, whose blobs are simply `text/markdown` story contents,
exactly as `ci-screenshots`/`ci-videos` hold images/videos.

After this feature, one userflows run on a branch leaves the complete golden set in
artifacts: the story documents the
[user-flow diff tab](qits-artifacts-workspace-userflow-diff-tab.md) compares
*and* a self-contained story document whose images/video resolve wherever the artifacts API
is reachable.

Related/dependent plans:

- **Hard dependency (producer side)** — [qits-userflows](qits-userflows.md): this is the
  renderer that plan's report model exists for; it consumes `userflow.json` (story,
  description, steps, screenshot paths + labels + content hashes, video path, definition
  hash, outcome) and **never parses the default markdown**. The renderer SPI framing there
  ("markdown is just the default renderer") is this plan's contract.
- **Hard dependency (store side)** — [qits-artifacts](../../qits-artifacts/feature-ideas/qits-artifacts.md): uses the upload
  API, the metadata contract, and the repository-type seam — `ci-userstories` is the first
  proof of that plan's claim that new types "slot in without touching the core".
- **Completes the loop for** the
  [user-flow diff tab](qits-artifacts-workspace-userflow-diff-tab.md): the `ci-userstories`
  documents this renderer publishes (with their deterministic `qits.diff.hash` and
  base-relative media URLs) are precisely the parent/workspace sides that tab evaluates and
  renders side-by-side.
- **Runs as a workspace action** — [actions](../../qits-feature-flows/features/2026-05-01_actions.md) /
  [feature-flows](../../qits-feature-flows/features/2026-05-01_feature-flows.md): branch/commit context enters here
  (the userflows module itself is deliberately branch-agnostic), read from the `/workspace`
  checkout the action runs in.
- **Moves with the extraction** —
  [qits-java-testing-integration-library](qits-java-testing-integration-library.md) (part 4 of
  the epic): the renderer code this plan places in the userflows module's `src/main` is part
  of what that extraction later relocates into the standalone library.

## The new repository type: `ci-userstories`

Added to artifacts's type roster (same validation-profile mechanism, no core changes):

- **Accepts**: `text/markdown` (and `text/plain` as a lenient alias; stored mediatype is what
  serving echoes).
- **Required metadata**: the git keys (`git.branch.name`, `git.commit.hash`),
  `qits.userflow.name`, `qits.userflow.hash`, `qits.display.name`, `qits.diff.hash`. No
  `media.resolution.*` — that family stays media-specific.
- Blobs are the **rendered story markdown**: description, step block, and media references as
  base-relative artifacts URLs (below). Content-addressing works unchanged — markdown is
  bytes like everything else.

## Renderer contract

Input: one story directory's `userflow.json` (+ the media files it references). Config: the
artifacts base URL and, when the write surface grows tokens, the credential — both from
environment/system properties, since the renderer runs inside workspace containers.

1. **Skip non-passing runs.** `outcome != "passed"` publishes nothing — a failed story's
   report is a local debugging artifact, never a golden.
2. **Resolve git context** once per run: branch and commit from the `/workspace` checkout
   (`git rev-parse HEAD`, `git branch --show-current`) — stamped on every upload.
3. **Ensure repositories** with artifacts's idempotent `PUT` (`ci-screenshots`, `ci-videos`,
   `ci-userstories`) — settling that plan's "who creates the repositories" question for this
   producer path: the producer does.
4. **Upload media first** (the URLs are needed before the document can render):
   - each screenshot → `ci-screenshots`, metadata straight from the sidecar:
     `qits.display.name` = the step label, `qits.diff.hash` = the sidecar's `contentHash`,
     `media.resolution.*` from the recorded dimensions, plus the shared story keys
     (`qits.userflow.name`, `qits.userflow.hash`) and git context;
   - the video → `ci-videos`, same shared keys; its **`qits.diff.hash` = a digest over the
     ordered screenshot content hashes plus the definition hash** — the "screenshot-trail
     digest" candidate from the artifacts plan, adopted here as the provisional v1 scheme
     (changed iff the flow definition or any captured frame changed; honest, cheap, and
     replaceable without touching the store since the hash is opaque by contract).
   - Content-addressed dedupe makes re-publishing cheap: unchanged bytes cost a metadata row,
     not storage.
5. **Render the story markdown against the uploaded URLs**: the same document shape as the
   default renderer, but every media reference is the blob's base-relative API path
   (`api/artifacts/repositories/ci-screenshots/blobs/<id>`) instead of a local filename.
   The render must be **deterministic** — no timestamps, no run ids — so identical inputs
   yield identical bytes.
6. **Upload the story document** → `ci-userstories`: `qits.display.name` = the story name,
   `qits.diff.hash` = the SHA-256 of the rendered markdown itself. Determinism (step 5) plus
   content-addressed media ids make this hash honest for free: the document's bytes change
   exactly when the description, the steps, or any referenced medium changed.
7. **Report the outcome** per story on stdout (uploaded/deduped counts, blob ids) — the action
   log is the operator surface.

## Design sketch

- **Code lives in the userflows module's `src/main`** (`…userflows.render.artifacts`), as
  the renderer SPI intends — not a new reactor module (it shares the report model, and a
  module holding one class family earns its keep only when the deployment story demands it).
  HTTP via `java.net.http` — no Quarkus, keeping the module's dependency posture.
- **Invocation is a separate step from the story run**: a plain `main` class walking
  `target/userstories/` (every story dir with a `userflow.json`), invoked by the action script
  after the test run (`mvn -pl userflows exec:java …` or a thin wrapper script). Decoupling
  upload from execution means a flaky network retries the cheap half, and local authoring runs
  never accidentally publish. (An auto-publish flag on the JUnit extension is a possible later
  convenience, not the default.)
- **The action convention** (documentation, not qits code): a "Record user flows" action that
  runs the extended userflows suite against the workspace's app, then invokes the renderer —
  executed on the parent branch once and on the workspace branch per change, which is exactly
  the two sides the diff tab needs. The userflows module's `CLAUDE.md` gains the renderer's
  run instructions alongside the existing ones.
- **URL form**: base-relative (`api/…`, no leading slash) per the webui convention, matching
  how the qits UI would resolve them when a story document is eventually displayed through a
  qits surface; a non-qits consumer prefixes the artifacts origin itself.

## Out of scope

- **Displaying `ci-userstories` documents** — that is the
  [user-flow diff tab](qits-artifacts-workspace-userflow-diff-tab.md)'s job; this renderer
  ends at the upload.
- Retention/pruning of story documents (rides the artifacts plan's open retention
  question).
- Any change to how stories run (the userflows plan owns that), and any CI orchestration
  beyond the documented action convention.
- Transcoding or thumbnailing — blobs upload as recorded.

## Open questions

- **Video diff-hash v1**: the screenshot-trail digest means a visual video change with no
  screenshot step and no definition change reads as *unchanged*. Acceptable for v1 (stories
  that care add a screenshot step); revisit when the artifacts plan's video-hash question
  settles for real.
- **Partial-publish atomicity**: media uploaded but the document upload fails → media rows
  exist without a story document. Content-addressed dedupe makes the retry converge, so
  "re-run the action" is likely answer enough — but the renderer should say so loudly in its
  outcome report rather than half-succeeding silently.
- **Credential plumbing**: depends on where the artifacts write-surface question lands
  (`PublicPaths` vs per-repository tokens). The renderer just passes through an env-provided
  token header when configured — it must not be the reason the token decision is rushed.

## Testing sketch

- **Renderer unit tests** (userflows module, against a stub HTTP server): upload order
  (media before document); metadata stamped per the mapping incl. both diff-hash schemes;
  deterministic document render (two runs, byte-identical); skip on `outcome: "failed"`;
  ensure-repositories `PUT`s issued; dedupe response handled; partial-failure outcome
  reported.
- **Artifacts side** (artifacts + service suites): `ci-userstories` type profile —
  markdown accepted, required keys enforced, no resolution keys demanded; roundtrip serves
  `text/markdown`.
- **End-to-end acceptance walk** (manual-acceptance-tests): run the reference story with the
  renderer against a real qits, verify the media land queryable by branch+flow and the story
  document's markdown resolves its own media URLs when fetched through the API.
