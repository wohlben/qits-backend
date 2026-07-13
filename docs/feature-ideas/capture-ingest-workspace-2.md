# Capture ingest: receive an SPA snapshot, branch off main, open a workspace with the context as its goal

## Introduction

The qits-side receiver for [SPA feature capture](spa-feature-capture-3.md): a new **open** endpoint
(`POST /api/capture`, CORS-permissive for any origin — on this one path only) that accepts a
snapshot posted directly by the running app's browser, resolves the **repository** it came from, creates a **new branch `feature/<date-time>` off the
repository's main branch**, and creates a **workspace on it whose `preamble` (the goal) carries
the captured context** — URL/route, environment, state, and the frozen DOM (size-capped).
The result of pressing the capture button in a running app is a workspace that an agent chat can
be pointed at immediately, goal pre-written from rendered reality.

Writing everything into the goal is **explicitly the temporary shape** ("to be extended further
later"): the preamble is the one context channel that already flows everywhere —
`PromptRefinementService` includes it, the workspace UI shows and edits it, agents read it. A
dedicated capture artifact store + explorer UI is the named extension, not this iteration.

Related / dependent plans:

- **Receives from** [spa-feature-capture](spa-feature-capture-3.md) — but is independently
  buildable and testable first (the payload is plain JSON; tests and curl can post it). Neither
  side blocks the other; the E2E demo needs both.
- **Reuses the creation path of**
  [create-workspace-for-workspaceless-branch](../features/2026-07-13_create-workspace-for-workspaceless-branch.md)'s
  substrate: `WorkspaceService.createWorkspace(repoId, id, parent, branch, preamble, adoptExisting=false)`
  — the normal loud-failure branch-off path, with `parent = repo.mainBranch`. No new git verbs.
- **Sibling of the OTLP receiver**
  ([observability](../features/2026-07-04_observability.md), `OtelReceiverResource` in
  `service`'s `telemetry.api`): same unauthenticated in-container trust stance, same
  identity-from-payload model — except capture **fails closed on unresolvable identity**
  (creating branches is not bucketing; there is no `_unscoped` for a git ref).
- **Lazy containers make this cheap**
  ([lazy provisioning](../features/2026-07-08_lazy-workspace-container-provisioning.md)):
  ingest writes a branch ref + a `STOPPED` row + preamble text. No container, no docker — a
  capture is durable rows until someone opens the workspace.
- The new workspace appears live in the UI via the existing `invalidateRepository` SSE path
  ([workspace-sse-live-updates](../features/2026-07-07_workspace-sse-live-updates.md)).
- **Consumed by** [capture-state-snapshot](capture-state-snapshot-4.md)'s payoff — registered
  state renders as fenced JSON in the goal.

## Motivation

Without a receiver, a capture is a JSON blob with nowhere to go. The receiving shape is a
product decision, and this is it: **a capture is the beginning of a feature branch.** Not a
gallery entry, not a bug report, not an annotation on the source workspace — a *new place to
work*, pre-loaded with the moment that prompted it. That maps one user gesture (button press)
to one qits concept (workspace with a goal), which is why the whole flow needs no new UI in
iteration one: the workspace detail page *is* the explorer, the goal *is* the snapshot view.

## Endpoint and identity

`POST /api/capture` — `service` module, a new `capture.api` resource beside the telemetry
receiver's pattern (`/api/capture` needs no Quinoa exclusion — `/api` is already ignored).

- **CORS-open, surgically** (decided 2026-07-13): the browser posts cross-origin from whatever
  origin the app runs on, so this path answers preflight and echoes permissive CORS headers
  (`Access-Control-Allow-Origin: *`, allowed method `POST`, allowed headers
  `Content-Type`/`Content-Encoding`) — implemented as a route-scoped filter pinned to exactly
  `/api/capture`, **not** `quarkus.http.cors` (which would open every endpoint). The rest of the
  qits API stays same-origin-only.
- **Body**: the capture payload (gzip or identity encoding), with the identity fields the SPA
  self-stamped from its `config.json` relay: `qits.repository.id` and `qits.workspace.id` (the
  *source* workspace the capturing app ran in — recorded as provenance in the goal; `null` for a
  deployed-outside-qits app that only knows its repository). Browser-supplied identity is the
  same unauthenticated trust level as the OTLP receiver's payload attributes.
- **Fail closed**: missing/unknown `qits.repository.id` → 404, nothing created. The OTLP
  receiver's fail-open `_unscoped` bucket is right for telemetry and wrong here.
- **Response**: `201` with the created workspace's ids, branch, and — the field the whole flow
  ends on — the **browser URL of the workspace page**, which the library navigates to:

```json
{
  "workspace": { "id": "…", "workspaceId": "feature-2026-07-13-1432", "branch": "feature/2026-07-13-1432" },
  "url": "http://…/repositories/<repoId>/workspaces/feature-2026-07-13-1432/wip"
}
```

  The origin is derived from the inbound request itself (the `Origin` header — always present on
  a cross-origin fetch, which this is by construction; fallback `Host`): whatever address the
  browser just successfully reached qits on is browser-reachable by definition, so qits never
  needs to know its own public URL. The path is the workspace detail route
  (`/repositories/{repoId}/workspaces/{workspaceId}/wip`).

- **Size guard**: reject bodies over a hard cap (e.g. 10 MB decompressed) with `413` — the goal
  renderer truncates the DOM anyway (below); a runaway payload should fail at the door.

## What ingest does

1. Resolve the repository row; 404 if absent.
2. Compose branch `feature/<yyyy-MM-dd-HHmm>` and workspace id `feature-2026-07-13-1432` (the
   server slug rule), de-colliding with `-2`, `-3` suffixes against existing branches/active
   workspaces (two captures in the same minute must both land). **Naming happens here, on the
   backend** (decided 2026-07-13): the capture flow has no user input anywhere, so the payload
   has nothing to name anything with — the branch and workspace id are derived entirely from
   the receive time.
3. Render the **goal markdown** from the payload (next section).
4. `createWorkspace(repoId, id, repo.mainBranch, branch, preamble, false)` — one transaction-ish
   unit in the existing service; the branch ref is created off main on the bare origin exactly
   like a UI "branch off".

## The goal (preamble) rendering

A markdown document, structured so both humans (workspace page) and agents
(`PromptRefinementService` already interpolates the preamble) consume it:

```markdown
# Captured from the running app — 2026-07-13 14:32 UTC

**Where**: `greeting/anna` (route `greeting/:name`) — https://…/greeting/anna
**Source workspace**: `main` · **Viewport**: 1440×900 @2x, dark · **Captured**: 2026-07-13T14:32:11Z

## App state at capture
```json
{ "cart": { … } }
```

## Rendered DOM (style-frozen)
<details><summary>~180 kB, truncated at 256 kB</summary>

```html
<html style="…">…
```
</details>
```

- **DOM truncation is the load-bearing decision.** `preamble` is a `@Lob` string edited in a
  textarea and echoed into prompts — a multi-MB DOM would poison both. Cap the embedded DOM
  (default 256 kB, config `qits.capture.goal-dom-max-bytes`) with an explicit truncation marker;
  the capture side's own cap plus compression makes overflow rare. Full-fidelity retention is
  the named extension (see Explicitly deferred), and its trigger is the first time a truncated
  capture loses the part that mattered.
- **The snapshot is the goal — there is no authored text in it.** The capture flow has no user
  input; the rendered evidence (where, when, state, DOM) *is* the starting goal, and the
  preamble stays editable in qits, which is where the human adds the actual intent ("fix the
  tooltip overlap visible in this capture") before pointing an agent at it.

## Testing (no browser, no library, no docker)

- `@QuarkusTest` on the fixture repo (the standard `testing-repo` setup): post a payload with a
  seeded repository's id → `201` whose `url` composes the request's `Origin` with the workspace
  detail route; branch `feature/<ts>` exists on the bare origin
  (`branchExistsOnOrigin` is already a probe); workspace row exists with `parent = mainBranch`
  and a preamble containing the route, fenced state, and DOM; posting twice in the same
  minute yields `-2` suffixed branch + workspace.
- Unknown repository id → 404, no ref created. Oversized body → 413, no ref created.
- Goal renderer unit tests (pure): state-less payload, DOM over the cap
  (marker present, well-formed markdown — the truncation must not split a fence).
- Gzip and identity encodings both accepted.
- CORS: an `OPTIONS /api/capture` preflight from a foreign `Origin` answers with the permissive
  headers, and the POST response echoes them; a sibling endpoint (e.g. `POST /api/otel/v1/traces`)
  gets none — the openness is provably scoped to the ingest path.
- Frontend: none needed — the workspace appears via existing list/SSE paths; visual baselines
  untouched.

## Explicitly deferred

- **Capture artifact storage + explorer** — persist the full payload (table or disk beside the
  repo data dir) and render the frozen DOM in a workspace tab (the
  [workspace-feature-dossier-tab](../backlog-ideas/workspace-feature-dossier-tab.md) shape is
  adjacent). Trigger: a truncated goal loses context someone needed, or goals become unwieldy to
  edit.
- **Capture → running agent** — auto-starting a workspace chat seeded from the goal. The goal
  already flows into `PromptRefinementService`; pressing "start agent" manually is fine for
  iteration one.
- **Branch naming beyond timestamps** — deriving a slug from capture content (e.g. the route
  pattern: `feature/2026-07-13-greeting-name`). Nice, but naming from arbitrary content needs
  sanitization rules that shouldn't block the loop.
- **Auth on the endpoint** — deliberately none for now (open API, prototype phase; today's
  effective trust boundary is network reachability of qits). The later shape is a relayed token
  sent as a header — see the auth open question in
  [spa-feature-capture](spa-feature-capture-3.md); the CORS filter is where it would be enforced.

## Open questions

- **Timestamp timezone**: `feature/<date-time>` in UTC or the server's zone? Lean UTC everywhere
  (matches `createdAt` handling and keeps ids sortable), with the human-readable goal header
  carrying the same instant.
- **Should the source workspace's goal get a back-link?** ("Captured into feature/… on …") —
  cheap provenance in the other direction, but it mutates a workspace the user didn't touch.
  Lean: no for now; the capture goal already names its source.
- **Domain area placement**: a new `capture` area vs. living in `repository` (it is mostly
  workspace creation). Lean: thin `capture.api` boundary in `service` + a small
  `capture.control` service in `domain` that composes the goal and delegates to
  `WorkspaceService` — mirrors how telemetry keeps its own area.
