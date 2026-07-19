# Capture ingest: receive an SPA snapshot, branch off main, open a workspace with the context as its goal

## Introduction

The qits-side receiver for [SPA feature capture](../../qits-integration-angular/features/2026-07-14_spa-feature-capture.md): an **open** endpoint
(`POST /api/capture`, CORS-permissive for any origin — on this one path only) that accepts a
snapshot posted directly by the running app's browser, resolves the **repository** it came from,
creates a **new `feature/<date-time>` branch off the repository's main branch**, and creates a
**workspace on it whose `preamble` (the goal) carries the captured context** — URL/route,
environment, state, and the frozen DOM (size-capped). The result of pressing the capture button in
a running app is a workspace that an agent chat can be pointed at immediately, goal pre-written
from rendered reality.

Writing everything into the goal is **explicitly the temporary shape** ("to be extended further
later"): the preamble is the one context channel that already flows everywhere —
`PromptRefinementService` includes it, the workspace UI shows and edits it, agents read it. A
dedicated capture artifact store + explorer UI is the named extension, not this iteration.

Related / dependent plans:

- **Receives from** [spa-feature-capture](../../qits-integration-angular/features/2026-07-14_spa-feature-capture.md) — but was
  independently built and tested first (the payload is plain JSON; tests and curl post it). Neither
  side blocks the other; the E2E demo needs both.
- **Reuses the creation path of**
  [create-workspace-for-workspaceless-branch](../../qits-workspaces/features/2026-07-13_create-workspace-for-workspaceless-branch.md)'s
  substrate: `WorkspaceService.createWorkspace(repoId, id, parent, branch, preamble, adoptExisting=false)`
  — the normal loud-failure branch-off path, with `parent = repo.mainBranch`. No new git verbs.
- **Sibling of the OTLP receiver**
  ([observability](../../qits-observability/features/2026-07-04_observability.md), `OtelReceiverResource` in
  `service`'s `telemetry.api`): same unauthenticated in-container trust stance, same
  identity-from-payload model — except capture **fails closed on unresolvable identity**
  (creating branches is not bucketing; there is no `_unscoped` for a git ref).
- **Lazy containers make this cheap**
  ([lazy provisioning](../../qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md)):
  ingest writes a branch ref + a `STOPPED` row + preamble text. No container, no docker — a
  capture is durable rows until someone opens the workspace.
- The capturing browser is **navigated to the returned workspace URL**, so it lands on the new
  workspace directly; other open qits tabs pick the workspace up on their next list fetch (the
  branch/workspace lists are client-side query-invalidated — there is no repository-level SSE
  channel, and none was needed for this flow).
- **Consumed by** [capture-state-snapshot](../../qits-integration-angular/features/2026-07-14_capture-state-snapshot.md)'s payoff
  (landed 2026-07-14) — registered state renders as fenced JSON in the goal.

## Motivation

Without a receiver, a capture is a JSON blob with nowhere to go. The receiving shape is a
product decision, and this is it: **a capture is the beginning of a feature branch.** Not a
gallery entry, not a bug report, not an annotation on the source workspace — a *new place to
work*, pre-loaded with the moment that prompted it. That maps one user gesture (button press)
to one qits concept (workspace with a goal), which is why the whole flow needed no new UI in
iteration one: the workspace detail page *is* the explorer, the goal *is* the snapshot view.

## What was built

- **`CaptureResource`** (`service`, `eu.wohlben.qits.domain.capture.api`) — the thin JAX-RS
  boundary at `POST /api/capture`: bounded gzip inflation, Jackson parsing, URL composition, `201`.
  Hidden from the OpenAPI document (like the OTLP receiver's endpoints), so the generated Angular
  client and `docs/openapi.yml` are untouched — this is a wire endpoint for the capture library.
- **`CaptureCorsRoute`** (`service`, same package) — a Vert.x route pinned to exactly
  `/api/capture` at router order 500 (before RESTEasy Reactive at 1500 — an explicit order is
  required, or REST's automatic OPTIONS handling answers the preflight without CORS headers). It
  answers `OPTIONS` with `Access-Control-Allow-Origin: *`, methods `POST, OPTIONS`, headers
  `Content-Type, Content-Encoding`, and stamps `Access-Control-Allow-Origin: *` on every other
  response passing through — including 404/413 errors, which a browser can only read cross-origin
  with the header present. Deliberately **not** `quarkus.http.cors` (which would open every
  endpoint); the rest of the qits API stays same-origin-only.
- **`CaptureService`** (`domain`, `eu.wohlben.qits.domain.capture.control`) — resolves the
  repository (fail closed), names the branch/workspace, renders the goal, and delegates to
  `WorkspaceService.createWorkspace(repoId, id, repo.mainBranch, branch, preamble, false)`.
- **`CaptureGoalRenderer`** (`domain`, same package) — pure markdown rendering of the goal from a
  framework-free **`CaptureContent`** DTO (`domain`, `capture.dto`; the boundary parses wire JSON
  and hands over plain strings — arbitrary app state arrives pre-serialized as `stateJson`).

## Endpoint and identity

`POST /api/capture` — no Quinoa exclusion needed (`/api` is already ignored).

- **CORS-open, surgically** (decided 2026-07-13): see `CaptureCorsRoute` above.
- **Body**: the capture payload (gzip or identity encoding — detected by the gzip magic bytes, not
  `Content-Encoding`, the OTLP receiver's proven pattern), with the identity fields the SPA
  self-stamped from its `config.json` relay: `qits.repository.id` and `qits.workspace.id` (the
  *source* workspace the capturing app ran in — recorded as provenance in the goal; `null` for a
  deployed-outside-qits app that only knows its repository). Browser-supplied identity is the
  same unauthenticated trust level as the OTLP receiver's payload attributes. Unknown payload
  fields are ignored (forward-compatible with capture-state-snapshot extensions).
- **Fail closed**: missing/unknown `qits.repository.id` → 404, nothing created. The OTLP
  receiver's fail-open `_unscoped` bucket is right for telemetry and wrong here.
- **Response**: `201` with the created workspace's ids, branch, and — the field the whole flow
  ends on — the **browser URL of the workspace page**, which the library navigates to:

```json
{
  "workspace": { "id": 42, "workspaceId": "feature-2026-07-14-1432", "branch": "feature/2026-07-14-1432" },
  "url": "http://…/repositories/<repoId>/workspaces/feature-2026-07-14-1432/wip"
}
```

  (`workspace.id` is the row's numeric primary key — the draft's example implied a string UUID,
  but workspaces use `@GeneratedValue Long` ids.)

  The URL's origin is **scheme + `Host` of the inbound request** — whatever address the browser
  just successfully reached qits on is browser-reachable by definition, so qits never needs to
  know its own public URL. (The draft said "`Origin` header, fallback `Host`", but `Origin` is the
  *capturing app's* origin — for a standalone cross-origin app, exactly the case this endpoint is
  CORS-open for, an Origin-composed URL would point at the app's server where `/repositories/…`
  doesn't exist. Host-first is what the draft's own rationale describes.) The path is the
  workspace detail route (`/repositories/{repoId}/workspaces/{workspaceId}/wip`).

- **Size guard**: bodies over `qits.capture.max-payload-bytes` (default 10 MB) **decompressed**
  are rejected with `413` — enforced *during* gzip inflation, so a gzip bomb never materializes in
  memory. The wire size is separately bounded by Quarkus' default `quarkus.http.limits.max-body-size`.

## What ingest does

1. Resolve the repository row; 404 if absent.
2. Compose branch `feature/<yyyy-MM-dd-HHmm>` (receive time, UTC) and workspace id
   `feature-2026-07-14-1432` (the server slug rule, `WorkspaceService.toWorkspaceSlug`),
   de-colliding with `-2`, `-3` suffixes against **both** existing branches and active workspace
   ids (two captures in the same minute must both land). **Naming happens on the backend**: the
   capture flow has no user input anywhere, so branch and workspace id derive entirely from the
   receive time.
   - **Dash fallback**: a repo with a branch literally named `feature` can never receive a
     `feature/*` ref (git's ref namespace is filesystem-like — `refs/heads/feature` blocks
     `refs/heads/feature/…`). Such repos get `feature-<timestamp>` instead; the `testing-repo`
     fixture is exactly this case, which is how the constraint surfaced.
3. Render the **goal markdown** from the payload (next section).
4. `createWorkspace(repoId, id, repo.mainBranch, branch, preamble, false)` — the branch ref is
   created off main on the bare origin exactly like a UI "branch off". `CaptureService.capture`
   is `synchronized` to close the probe-then-create race between concurrent same-minute captures.

## The goal (preamble) rendering

A markdown document, structured so both humans (workspace page) and agents
(`PromptRefinementService` already interpolates the preamble) consume it:

```markdown
# Captured from the running app — 2026-07-14 14:32 UTC

**Where**: `greeting/anna` (route `greeting/:name`) — https://…/greeting/anna
**Source workspace**: `main` · **Viewport**: 1440×900 @2x, dark · **Captured**: 2026-07-14T14:32:11Z

## App state at capture
```json
{ "cart": { … } }
```

## Rendered DOM (style-frozen)
<details><summary>~180 kB, truncated at 256 kB</summary>

```html
<html style="…">…
```

*Truncated at 262144 bytes (DOM was 812345 bytes; config `qits.capture.goal-dom-max-bytes`).*
</details>
```

- **DOM truncation is the load-bearing decision.** `preamble` is a `@Lob` string edited in a
  textarea and echoed into prompts — a multi-MB DOM would poison both. The embedded DOM is capped
  (default 256 kB, config `qits.capture.goal-dom-max-bytes`) with an explicit truncation marker;
  the capture side's own cap plus compression makes overflow rare. Full-fidelity retention is
  the named extension (see Explicitly deferred), and its trigger is the first time a truncated
  capture loses the part that mattered.
- **The rendering is defensively well-formed**: every code fence is sized strictly longer than the
  longest backtick run in its body (a DOM legitimately contains backticks), truncation is
  UTF-8-byte-accurate and never splits a code point, and the closing fence is appended *after*
  capping so it can never be cut. Every payload field is optional — a sparse `{}` payload still
  renders a valid goal.
- **The snapshot is the goal — there is no authored text in it.** The capture flow has no user
  input; the rendered evidence (where, when, state, DOM) *is* the starting goal, and the
  preamble stays editable in qits, which is where the human adds the actual intent ("fix the
  tooltip overlap visible in this capture") before pointing an agent at it.

## Testing (no browser, no library, no docker)

- `CaptureResourceTest` (`@QuarkusTest`, `service`): happy path on the `testing-repo` fixture
  (201, dash-fallback branch shape, Host-composed URL, parent = main, `STOPPED` runtime status,
  preamble carrying route/state/DOM); same-instant de-collision through the `CaptureService` seam
  with one fixed `Instant` (`feature/…-1200`, `-2`, `-3` on the slash-safe
  `testing-repo-quarkus-angular` fixture — a REST-level double post would flake at minute
  boundaries); unknown/missing repository → 404 with nothing created; oversized identity body and
  a **gzip bomb** → 413 with nothing created; gzip and identity encodings both accepted; CORS
  preflight + POST/error responses carry the permissive headers while `POST/OPTIONS
  /api/otel/v1/traces` provably get none; state-less payload omits the state section.
- `CaptureGoalRendererTest` (plain JUnit, `domain`): full template, sparse payloads, byte-cap
  truncation with marker, UTF-8 boundary safety, backtick-run fence escalation, truncation landing
  inside a backtick run, branch-name shapes (slash, dash fallback, UTC).
- Frontend: none needed — the endpoint is hidden from the OpenAPI document, `docs/openapi.yml` is
  unchanged, and the capturing browser navigates to the returned URL; visual baselines untouched.

## Resolved open questions (from the draft)

- **Timestamp timezone**: UTC (matches `createdAt` handling, keeps names sortable); the goal
  header renders the same instant human-readably.
- **Back-link in the source workspace's goal**: no — it would mutate a workspace the user didn't
  touch; the capture goal already names its source.
- **Domain area placement**: thin `capture.api` boundary in `service` + `capture.control`/
  `capture.dto` in `domain`, delegating to `WorkspaceService` — mirrors how telemetry keeps its
  own area.

## Explicitly deferred

- **Capture artifact storage + explorer** — persist the full payload (table or disk beside the
  repo data dir) and render the frozen DOM in a workspace tab (the
  [workspace-feature-dossier-tab](../../../backlog-ideas/workspace-feature-dossier-tab.md) shape is
  adjacent). Trigger: a truncated goal loses context someone needed, or goals become unwieldy to
  edit.
- **Capture → running agent** — auto-starting a workspace chat seeded from the goal. The goal
  already flows into `PromptRefinementService`; pressing "start agent" manually is fine for
  iteration one.
- **Branch naming beyond timestamps** — deriving a slug from capture content (e.g. the route
  pattern: `feature/2026-07-14-greeting-name`). Nice, but naming from arbitrary content needs
  sanitization rules that shouldn't block the loop.
- **Auth on the endpoint** — deliberately none for now (open API, prototype phase; today's
  effective trust boundary is network reachability of qits). The later shape is a relayed token
  sent as a header — see the auth open question in
  [spa-feature-capture](../../qits-integration-angular/features/2026-07-14_spa-feature-capture.md); the CORS route is where it
  would be enforced.
