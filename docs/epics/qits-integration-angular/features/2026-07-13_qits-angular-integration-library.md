# qits Angular integration library: `provideQitsIntegration()` instead of copy-paste

> **Status: implemented 2026-07-13.** The library lives in
> [`wohlben/qits-angular-integration`](https://github.com/wohlben/qits-angular-integration) (commit `9be4580` ports the
> convention; 27 unit tests across 7 spec files cover gating, exporter URL composition,
> `ignoreUrls`, error-record shape, route/interaction stamping, and frame parsing) and the
> fixture consumes it as a SHA-pinned git dependency (fixture commit `9b91238` — `telemetry.ts`
> deleted, two-line wiring, `onlyBuiltDependencies` allowlist). As-built notes against the plan
> below: the `packageExtensions` zone.js workaround **does not propagate** from the library
> (pnpm reads it from the consumer's root manifest only) but it's a peer-warning silencer, not
> an install blocker, so the library did *not* need to vendor the interaction wiring — every
> consumer keeps the entry, documented in the library README; the library's `check-exports`
> gained a `dependencies`-drift check (root and `projects/qits-angular-integration/package.json` both carry
> the OTEL deps — one feeds the consumer's package manager, the other ng-packagr);
> `TelemetryErrorHandler` stays unexported (provided via `provideQitsIntegration()`), keeping
> the public API to exactly the two functions + two types. The guide's Tier 5 was rewritten in
> the same change.

## Introduction

Package the SPA half of the qits integration convention — today four files copied from the
`testing-repo-quarkus-angular` fixture per the
[integration guide](../../../guides/quarkus-angular-integration.md) Tier 5 — into a **distributable
Angular library** (working name `@qits/angular`). An app opts in with two lines instead of ~400
copied ones:

```ts
// main.ts — before bootstrapApplication (withFetch capture ordering, unchanged)
await initQitsIntegration();

// app.config.ts
providers: [provideQitsIntegration()]
```

This is the foundation for making the integration *grow features* instead of *grow the copy*: the
[SPA feature capture button](2026-07-14_spa-feature-capture.md) and the
[state snapshot integration](2026-07-14_capture-state-snapshot.md) ship inside this library, so an
integrated app gets them by upgrading a dependency, not by re-copying files.

Related / dependent plans:

- **Preceded by** [angular-lib-repo-bootstrap](../features/2026-07-13_angular-lib-repo-bootstrap.md)
  — creates the standalone `wohlben/qits-angular-integration` repository and proves the git-install
  distribution mechanics with a walking skeleton; this plan fills that proven shell with the
  ported convention.
- Packages the as-built conventions of
  [spa-observability](../../qits-observability/features/2026-07-06_spa-observability.md) and
  [spa-telemetry-meta-enrichment](../../qits-observability/features/2026-07-11_spa-telemetry-meta-enrichment.md) —
  the library is a *repackaging* of `telemetry.ts` + `TelemetryErrorHandler` +
  `provideRouteTelemetry()`, not a redesign. Every trap those docs encode (verbatim exporter
  URLs, `ignoreUrls`, zoneless `ErrorHandler` funnel, 1 s flush) moves into the library verbatim.
- Rewrites the [integration guide](../../../guides/quarkus-angular-integration.md) Tier 5 in the same
  change (the guide's contract: the change that breaks it updates it).
- Modifies the [servable fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md):
  the fixture's copied `telemetry.ts` is replaced by the library dependency — the fixture stays
  the reference implementation, now of the *library consumption* instead of the file copy.
- Depended on by [spa-feature-capture](2026-07-14_spa-feature-capture.md) and
  [capture-state-snapshot](2026-07-14_capture-state-snapshot.md) (they are library features), and indirectly
  by [capture-ingest-workspace](../../qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md) (its E2E story runs through the
  library's capture button).
- **Backend resources are out of scope.** `ConfigResource` / `OtelProxyResource` are Java and
  stay app-side copies for now; a Quarkus extension counterpart is a separate later idea (see
  Explicitly deferred).

## Motivation

The current convention is deliberate ("instrumentation is the target app's business") but its
distribution mechanism is copy-paste: the guide says *"Copy all four files from the fixture."*
That was right when the surface was small and settling. It stops being right the moment the
integration becomes a *product surface* that evolves — the capture button idea is exactly that
moment. Copied files mean every integrated app forks the convention at its copy date; a library
means the convention has versions, a changelog, and an upgrade path.

Secondary motivation: the copied `telemetry.ts` is ~200 lines of trap-encoding SDK wiring that no
app author should read, let alone diff against the fixture after a convention change.

## Shape of the library

### Public API

```ts
// Pre-bootstrap: fetches config.json, gates, sets up OTEL SDKs + fetch/document-load
// instrumentation + the code.* caller-attribution fetch wrapper. Resolves fast when dark.
export async function initQitsIntegration(options?: QitsIntegrationOptions): Promise<void>;

// DI wiring: TelemetryErrorHandler, route telemetry (navigation spans + app.route.* stamping),
// interaction instrumentation. Accepts optional features (capture, state snapshot) later.
export function provideQitsIntegration(...features: QitsIntegrationFeature[]): EnvironmentProviders;

export interface QitsIntegrationOptions {
  /** Where to fetch the identity relay; default 'api/config.json' (base-relative). */
  configUrl?: string;
}
```

- **The two-phase shape is load-bearing, not incidental.** `initQitsIntegration()` must complete
  before `bootstrapApplication` because Angular's `FetchBackend` captures `window.fetch` on first
  use ([spa-observability](../../qits-observability/features/2026-07-06_spa-observability.md) implementation notes).
  The library cannot hide this inside a provider; it documents it as the one-line `main.ts`
  contract instead.
- **`config.json` stays the only runtime config channel.** The library takes no endpoint, no
  service name, no resource attributes at build time — everything rides the existing identity
  relay, so the gate semantics are unchanged (standalone/otel-off runs stay dark, the library is
  inert dead weight). `QitsIntegrationOptions` exists for the config URL and future toggles only.
- **The feature-argument pattern** (`provideQitsIntegration(withFeatureCapture(), …)`) mirrors
  `provideHttpClient(withFetch())` — the base call is telemetry-only and later ideas add
  themselves as tree-shakable features rather than options that bloat every consumer.
- The `<base>` rebase stays an inline `index.html` script (it must run before any module code);
  the library README carries the canonical snippet, same as the guide today.

### What moves in, file by file

| Today (fixture copy) | In the library |
|---|---|
| `src/telemetry.ts` (SDK setup, exporters, processors, route/interaction/fetch enrichment) | `initQitsIntegration` + internal modules |
| `TelemetryErrorHandler` | provided by `provideQitsIntegration()` |
| `provideRouteTelemetry()` | folded into `provideQitsIntegration()` |
| `main.ts` wiring | the documented two lines |
| `ConfigResource` / `OtelProxyResource` (Java) | **not moved** — still copied app-side |

The OTEL npm dependencies become the library's `dependencies` (same pinned ranges the guide lists
today), so `pnpm add @qits/angular` replaces the eleven-package install block. The
`instrumentation-user-interaction` zone.js peer workaround (`packageExtensions`) needs
re-validating under library packaging — if it doesn't propagate, the library vendors the
interaction wiring instead (it already customizes it via `shouldPreventSpanCreation`).

## Where the source lives, and how it ships

**Decided (2026-07-13): distribution is git-only for now — no npm publishing, prototype phase.**
Consumers install straight from the library's git repository
(`pnpm add "git+<repo-url>#<rev>"`); pnpm builds git dependencies on install via a `prepare`
script, so the repo carries source + ng-packagr config and `prepare` runs the library build.

That decision also settles *where* it lives: **its own repository**, like the fixture repos —
git dependencies resolve a repo root as the package, and subdirectory git deps are not reliably
supported, which rules out nesting it inside qits' webui workspace. Consequences accepted:

- A third repo in the family; qits' docs workflow doesn't reach it, so the library repo carries
  its own README as the consumer contract and this repo's guide links to it.
- The `prepare`-build path (ng-packagr running on the consumer's install) must be validated
  early — it is the one moving part of git distribution. If it fights, the fallback is
  committing the `dist/` output on a release branch and pointing the git ref there. Both the
  validation and the repo skeleton are carved out as their own step-0 plan:
  [angular-lib-repo-bootstrap](../features/2026-07-13_angular-lib-repo-bootstrap.md).
- Rejected: inside the fixture repo (the fixture demonstrates consumption; a library living in
  its own demo can't be consumed by anyone else), and inside qits' webui workspace (see above —
  revisit if distribution ever moves to a registry).

## Testing (separately green before anything consumes it)

- **Library unit tests** (Vitest, same toolchain as the qits webui): config fetch + gating
  (`telemetry: null` ⇒ no SDK objects constructed, fetch untouched); exporter URL composition
  from `document.baseURI`; `ignoreUrls` excludes the passthrough path; error handler emits
  ERROR-severity log records with `exception.*`; route/interaction attribute stamping — porting
  the assertions the fixture's behavior currently only gets from manual E2E.
- **Fixture migration is the integration test:** replace the copied files with the dependency,
  then the existing acceptance holds unchanged — `seed-webapp`, web view, one full-stack trace
  per interaction, provoked SPA error in Recent errors ([guide](../../../guides/quarkus-angular-integration.md)
  final acceptance). The fixture's own backend tests (`ConfigResourceTest` etc.) are untouched.
- **qits itself changes zero runtime code** — this idea is green when the fixture E2E loop is.

## Explicitly deferred

- **A Quarkus extension for the backend half** (`ConfigResource`/`OtelProxyResource` as a
  `qits-quarkus` dependency). Same motivation, different ecosystem; wait until the Java surface
  grows past two small resources.
- **npm publish + versioning policy** — decided out for the prototype phase; git refs are the
  version pins until someone outside this repo family consumes the library.
- **Non-Angular ports** (React/Vue) — the convention is framework-shaped (ErrorHandler, Router);
  a port is a rewrite, not a build target.

## Open questions

- Package name: `@qits/angular` vs `@qits/integration` — lean `@qits/angular` (the framework is
  the variant axis, per the deferred ports). Scoped names work fine for git deps; the scope only
  matters if publishing ever happens.
- Does the qits UI itself eventually consume the library (self-observability)? Named in
  [spa-observability](../../qits-observability/features/2026-07-06_spa-observability.md) as a separate idea; the
  library makes it cheap, but it stays out of scope here.
- Angular version support window: the library pins Angular 21 peers (what qits and the fixture
  run); do we owe a wider range on day one? Lean: no — first consumer wins.
