# Integration guide: from a fresh Quarkus starter to a fully qits-managed Quarkus/Quinoa/Angular app

## Introduction

qits now has a real integration *contract* for a Quarkus/Quinoa/Angular app — dev-server daemon,
web view under the proxy prefix, log observation, backend OTEL, and (once
[spa-observability](spa-observability.md) lands) frontend OTEL through the backend gateway. But
that contract exists only as the **sum of the fixture's diffs**: scattered across feature docs,
seed code comments, and resolved-issue write-ups. Someone pointing qits at their *own* app — or a
coding agent asked to "integrate this repo with qits" — has no single document saying what to
configure. This idea produces that document: a durable, user-facing guide walking from a **stock
`code.quarkus.io` starter** (REST + Quinoa, Angular in `src/main/webui/`) to a fully integrated
app, *validated by actually performing that walk*.

**Sequenced after [spa-observability](spa-observability.md)** — the guide should document the
complete contract in one pass, and the frontend-telemetry decrees (`/api/config.json`, the OTLP
passthrough) are the last piece of it. Writing the guide first would mean revising it immediately.

Related/dependent plans:

- **Generalizes [fully integrate the Quarkus+Angular fixture](../features/2026-07-05_quarkus-angular-fixture-full-integration.md)**
  — that feature made the *fixture* exercise every surface and its §A–§C tables are this guide's
  raw material. But it is fixture-facing (what the fixture and `SeedWebappService` had to become),
  and it predates the [web-view configuration](../features/2026-07-06_daemon-webview-configuration.md)
  rework (frontend dev server on :4200 as the framed target, `entryPath`, the `index.html`
  `<base>` rebase, `proxy.conf.js`) and spa-observability. The guide is the *user-facing,
  current-state* rewrite.
- **Documents the contracts of** [daemons](../features/2026-07-04_daemons.md),
  [daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md),
  [daemon log observation](../features/2026-07-04_daemon-log-observation-expansion.md),
  [observability](../features/2026-07-04_observability.md),
  [spa-observability](spa-observability.md), and the repo-shape signals of the
  [framework-aware file browser](../features/2026-07-03_framework-aware-file-browser.md) — no code
  change to any of them; where walking the guide reveals friction, that's an issue doc against the
  feature, not a guide workaround (see Method).
- **Reference implementation:** the
  [servable fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md) +
  `SeedWebappService` — the guide's end state is "your app behaves like the seeded fixture", and
  every snippet can be checked against fixture `main`.
- **Distills resolved issues** so their gotchas aren't rediscovered — e.g.
  [quarkus OTEL endpoint not bridged in dev mode](../issues/resolved/2026-07-05_quarkus-otel-endpoint-not-bridged.md)
  (the `-Dquarkus.otel.exporter.otlp.endpoint=$OTEL_EXPORTER_OTLP_ENDPOINT` startScript bridge).

## The deliverable

A guide at **`docs/guides/quarkus-angular-integration.md`** — a new `docs/guides/` home for
durable how-to documentation, distinct from `docs/features/` (development history: what was built
and why) and `docs/feature-ideas/` (what might be built). Guides describe the *current* contract
and are updated in place when a feature changes it; this one is the first occupant and sets the
shape.

Written for two readers at once:

1. **A human** integrating their own Quarkus/Quinoa/Angular repo.
2. **The coding agent** — a workspace chat pointed at the guide (or a repo's `CLAUDE.md` linking
   it) should be able to execute the integration. That means imperative checklist steps,
   copy-paste-complete snippets, and explicit verify-after-each-step commands — no "see the
   fixture for details".

## What the guide covers (the contract, inventoried)

Structured as **tiers**, each independently useful, each ending in a verification step — so a
partial integration is a valid stopping point, not a broken one:

**Tier 0 — repo shape (detection + agent context).** What the file browser and agent read from the
clone alone: committed `./mvnw`, root `pom.xml` mentioning quarkus (→ `Java / Quarkus` label),
`src/main/webui/angular.json` (→ `TypeScript / Angular`), a `docs/` dir with markdown (→ `Docs`),
`*.spec.ts` beside components (test↔code tabs), a repo-local `CLAUDE.md` + `.claude/` for the
agent. A stock starter already has the first two; the rest is additive.

**Tier 1 — the dev-server daemon.** The daemon definition itself: a `startScript` that runs
`quarkus:dev` (host `0.0.0.0`, pinned port), a `readyPattern` matched to *what READY should mean*
(the Angular dev server's readiness lines when the web view targets :4200 — not Quarkus'
"Listening on"), and the first-launch cost warning (Maven + pnpm downloads vs. the ready grace
window). Verify: daemon reaches READY, restart survives.

**Tier 2 — web view.** The base contract from the app's side, per
[daemon web-view configuration](../features/2026-07-06_daemon-webview-configuration.md):
`webView {port: 4200, entryPath}`, `ng serve --host 0.0.0.0 --serve-path "$QITS_PUBLIC_BASE"` in
`package.json`, the `index.html` runtime `<base>` rebase (Angular 21's dev server has no
`--base-href`), `proxy.conf.js` forwarding the based `api/` path to the backend, base-relative
fetches in the SPA, and the recreate-container rule (ports publish at container creation). This is
the tier the guide exists most for — historically the trap step, where every base misconfiguration
presents as the same blank or asset-404'd iframe (the exact failure mode that motivated the
web-view configuration feature); the guide must spell out each contract piece *and* the symptom of
getting it wrong. Verify: **the web view actually works** — the frame opens on `entryPath`, assets
+ HMR live, an API POST succeeds through the prefix, and the DOM picker attaches.

**Tier 3 — logs to qits.** `LOG_LEVEL` observer (free Java stack-trace classification), a
`PATTERN` observer for stack-specific failure lines (`BUILD FAILURE|Failed to start Quarkus|Live
reload failed`), and — for a rolling file — `quarkus.log.file.*` in `application.properties` plus
a `FILE` `LogSource` on `quarkus.log`. Verify: a provoked error appears as a `daemon_event` (now
under the workspace's Events tab) and as a `[daemon:…]` note in a running chat.

**Tier 4 — backend OTEL.** `quarkus-opentelemetry` (+ `quarkus.otel.logs.enabled`,
`quarkus.otel.metrics.enabled`, `http/protobuf`), `otel=true` on the daemon, and the env→property
bridge gotcha: **dev mode does not honor `OTEL_EXPORTER_OTLP_ENDPOINT`**, so the `startScript`
must pass `-Dquarkus.otel.exporter.otlp.endpoint=$OTEL_EXPORTER_OTLP_ENDPOINT` (the resolved-issue
distillation). Verify: Recent traces + Metrics populate in the Telemetry tab; the agent's
telemetry MCP tools attach.

**Tier 5 — frontend OTEL** (the spa-observability decrees): the `ConfigResource`
(`/api/config.json` identity relay), the `OtelProxyResource` (OTLP passthrough), `telemetry.ts` +
the OTEL web SDK dependencies, the `ignoreUrls` self-export exclusion. Verify: one full-stack
trace per interaction, a provoked SPA error in the errors feed.

Cross-cutting, as a reference table: **every env var qits injects and what the app must do with
it** — `QITS_PUBLIC_BASE` (serve under it), `OTEL_EXPORTER_OTLP_*` (bridge to dev mode / relay to
the browser), `OTEL_RESOURCE_ATTRIBUTES` (relay verbatim), `TERM` — plus what the container
guarantees (JDK 25 / node / pnpm in `qits/workspace`, host uid, `/workspace` clone).

## Method: the walk is the validation

The guide is written **by performing it**: generate a fresh starter (`code.quarkus.io`,
`rest-jackson` + `quinoa`, Angular scaffolded into `src/main/webui/`) in a scratch repo, register
it with qits, and walk tier by tier, recording the exact diff each tier required. Then
cross-check against fixture `main` (`git diff` mentality: anything the fixture has that the guide
never needed is either fixture-specific or a missed step — resolve which).

The walk's acceptance is deliberately strict on the visible surfaces: it is **not complete until
the web view renders the starter's SPA through the proxy prefix** (Tier 2's verify block) — a
guide that gets a fresh app to READY but leaves a blank iframe has failed at the exact step users
need it for.

Per the repo's documentation workflow, **friction found during the walk is filed, not papered
over**: anything that needs an undocumented workaround, a magic value, or a qits code change
becomes an issue doc / backlog entry against the owning feature, and the guide links it. The walk
is thus also an end-to-end audit of the integration surface — the first real "user" that isn't
the fixture.

## Explicitly deferred

- **Other stacks** (plain Node/Vite, Python, Spring) — the tier structure should generalize, but
  each guide needs its own validated walk; write them when a real second stack shows up.
- **Automating the integration** — a qits action/feature-flow or an agent skill that *applies* the
  guide to a repo ("integrate this app"). The guide's agent-executable phrasing is the
  prerequisite; the automation is its own idea once the guide has been exercised manually.
- **Machine-checking the contract** — a preflight probe ("does the daemon serve under
  `$QITS_PUBLIC_BASE`? does `/api/config.json` answer?") overlaps the
  [daemon-healthchecks](daemon-healthchecks.md) idea's territory; the guide documents, the probe
  idea verifies.
- **A starter template repo** (pre-integrated archetype to clone instead of a guide to follow) —
  attractive, but it rots silently; the guide + fixture pairing keeps the contract reviewable.

## Open questions

- **`docs/guides/` as a new category.** Lean yes — features/ is history, ideas/ is future, and
  the current-state contract needs a home that's updated in place. Alternative: a `docs/README.md`
  index section instead of a directory, if one guide stays the only occupant for long.
- **How much of the guide belongs in the fixture's own README?** The fixture repo is what users
  will diff against; a short pointer from the fixture's README to the guide (or vice versa) avoids
  two drifting copies. Lean: guide in qits owns the content, fixture README points at it.
- **Seed-webapp as executable acceptance.** Should the guide's final verification simply be "your
  workspace now passes the same manual E2E loop as `seed-webapp`" — reusing the fixture's
  known-good state as the acceptance definition? Lean yes; it keeps one canonical checklist.

## Testing sketch

- The deliverable is documentation; its test **is the Method walk** — a fresh starter reaches
  every tier's verify step by following only the guide.
- Regression proxy: the fixture + `seed-webapp` E2E loop stays the executable form of the guide's
  end state; when a feature changes the contract, the failing seed/fixture is the signal to update
  the guide in the same change.
- Each tier's "Verify" block doubles as the manual test script for the corresponding feature —
  written so the [verify](../../CLAUDE.md) workflow (agent-browser against :8080) can execute it.
