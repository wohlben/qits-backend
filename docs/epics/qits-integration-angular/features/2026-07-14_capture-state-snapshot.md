# Capture state snapshot: a signalStore feature that serializes app state into a capture

## Introduction

The state dimension of [SPA feature capture](2026-07-14_spa-feature-capture.md): a small registry in the
[qits Angular integration library](2026-07-13_qits-angular-integration-library.md) that apps hook their
state into, so a capture carries **what the app knew**, not just what it rendered. Primary
integration is an `@ngrx/signals` custom feature — `withQitsSnapshot('name')` — because that is
the state idiom of this repo family (qits' own webui decrees `signalStore`/`signalState`); a
function-based escape hatch covers everything else.

```ts
// In a signalStore — one line, self-registering:
export const CartStore = signalStore(
  { providedIn: 'root' },
  withState(initialCart),
  withQitsSnapshot('cart'),
);

// Escape hatch for non-ngrx state (plain signals, services, anything):
registerCaptureState('session', () => ({ user: auth.user()?.name ?? null }));
```

At capture time, the [capture payload](2026-07-14_spa-feature-capture.md)'s `state` field becomes
`{ "cart": {…}, "session": {…} }`.

Related / dependent plans:

- **Consumed by** [spa-feature-capture](2026-07-14_spa-feature-capture.md) — capture works without any
  registered state (the `state` field is just absent/empty), and this integration is testable
  without capture (the registry is a pure library seam). Strictly separable, in both directions.
- **Ships in** [qits-angular-integration-library](2026-07-13_qits-angular-integration-library.md) — hard
  dependency on the library existing.
- **Lands in the goal text via** [capture-ingest-workspace](../../qits-feature-intake/features/2026-07-14_capture-ingest-workspace.md) — the
  ingest renders registered state as fenced JSON in the workspace preamble, which is what makes
  "the dropdown was empty because the store's `filters` were stale" visible to the agent without
  reproduction steps.
- The **fixture** (`testing-repo-quarkus-angular`) currently has no signalStore — demonstrating
  this feature means giving the greeting SPA a small store (e.g. greeting history), which is a
  fixture change in the usual procedure (`main` + `feature/greeting` rebase).

## Motivation

A frozen DOM shows the symptom; state shows the cause. "The list renders empty" is ambiguous
between *the store held no items* and *the render dropped them* — with `{"items": [...]} `in the
capture, the agent starts at the right layer. State is also the part of a snapshot no external
tool (screenshot, DOM serializer, session replay) can get: it requires cooperation from inside
the app, which is exactly what the integration library is for.

Why explicit registration instead of automatic discovery: there is no global registry of
signalStores to enumerate (root stores are just DI providers), and auto-capturing *all* state is
a privacy/size hazard anyway. Registration is the app author curating what a feature-idea
snapshot should carry — the same judgment call as `data-track-event` naming in the
[interaction telemetry convention](../../qits-observability/features/2026-07-11_spa-telemetry-meta-enrichment.md).

## Design

### The registry

A module-scoped `Map<string, () => unknown>` inside the library (like the OTEL wiring, it
predates and outlives any component tree):

- `registerCaptureState(name, supplier): () => void` — returns an unregister function. Duplicate
  names: last registration wins, with a `console.warn` (hot-reload re-registration makes
  throwing hostile).
- Suppliers run **lazily at capture time only** — zero cost until the button is pressed, and the
  snapshot is of the state *at that moment* (consistent with the DOM freeze being
  moment-in-time).

### `withQitsSnapshot(name)`

A standard `signalStoreFeature`:

- `withHooks.onInit`: `registerCaptureState(name, () => getState(store))` —
  `getState` is public `@ngrx/signals` API and returns the plain state object of any store.
- `onDestroy`: unregister — component-provided (non-root) stores come and go; a destroyed
  store must not leave a dangling supplier reading from a dead injector.
- Only `withState` slices are captured (that is what `getState` sees); computed values are
  derivable and deliberately excluded.

### Serialization safety

Suppliers return arbitrary objects; captures must never fail because of one bad store:

- Each supplier runs in its own try/catch; a throwing supplier contributes
  `{"$error": "supplier threw: …"}` instead of aborting the capture.
- Values pass through a **JSON-safe sanitizer**: depth cap (default 8), per-entry size cap
  (default 64 kB, then `"$truncated": true`), cycles broken with `"$circular"`, functions /
  DOM nodes / non-plain class instances replaced by `"$unserializable(<type>)"`. `Map`/`Set` are
  converted (signalStore state should be plain, but escape-hatch suppliers won't be).
- **Redaction is the author's job**, stated plainly in the docs: register a projection
  (`() => ({...getState(store), token: undefined})`) rather than expecting the library to guess
  what is sensitive. A later `redactKeys` option is cheap if a pattern emerges.

## Testing (pure library, no backend, no capture button)

- Registry: register/unregister/duplicate-name semantics; supplier laziness (not invoked until
  snapshot); one throwing supplier doesn't poison the rest.
- `withQitsSnapshot`: a test store registers on init with `getState` parity, unregisters on
  destroy (TestBed scope teardown).
- Sanitizer: cycle, depth, size, `Map`/`Set`, class instance, function — each yields its marker,
  everything else round-trips `JSON.parse(JSON.stringify(...))`-clean.
- Integration (with [spa-feature-capture](2026-07-14_spa-feature-capture.md), once both exist): a browser
  spec asserting the POSTed payload's `state` contains the registered slices.

## Open questions

- **Name**: `withQitsSnapshot` vs `withCaptureSnapshot` — lean `withQitsSnapshot`, the qits
  prefix marks it as integration-owned in an app's store definition.
- Should the fixture's demo store live in this idea or in
  [spa-feature-capture](2026-07-14_spa-feature-capture.md)'s fixture change? Lean: here — it is the
  reference for *this* API, and capture's fixture change is already load-bearing.
- Version pinning: `signalStoreFeature` API stability across `@ngrx/signals` versions — the
  library should declare a peer range validated against what qits and the fixture actually use.

## As built (2026-07-14)

Implemented as planned; library commit `0c49d33` in `qits-angular-integration`, consumed by the fixture at
that pin. The open questions resolved to their leans: the name is **`withQitsSnapshot`**, the
fixture's demo store shipped here, and `@ngrx/signals` became a **required peer** at `^21.0.0`
(validated against qits' webui `^21.1.0` and the fixture, both on Angular 21). Decisions taken
during implementation:

- **The registry read happens inside `buildCapturePayload`** (like the existing
  `currentRoutePattern()` read) — `collectCaptureState()` returns `undefined` when nothing is
  registered, so a state-less payload omits `state` entirely and the ingest omits the goal
  section.
- **The unregister function is identity-guarded**: it deletes only if the registry still holds
  *its own* supplier, so a destroyed store's teardown can't remove the live supplier that a
  hot-reload re-registration installed under the same name.
- **Registration happens in `onInit`, not the `withHooks` factory body** — the factory runs
  mid-store-construction. The supplier `() => getState(store)` is injection-context-free (pure
  signal reads), so captures can run it from outside Angular.
- **Sanitizer decisions beyond the plan**: `BigInt` → decimal string (the one value
  `JSON.stringify` *throws* on — without this a single `10n` would `$error` the whole entry);
  typed arrays are `$unserializable` (megabytes of canvas pixels stay out of captures);
  `Date` → ISO string; cycle detection is ancestor-path-based so shared DAG references still
  serialize; the 64 kB per-entry cap replaces the entry wholesale with
  `{"$truncated": true, "bytes": …}` rather than trimming progressively — an entry that large is
  an authoring bug the marker surfaces.
- **The per-supplier try/catch wraps the sanitizer walk too** — plain-object property getters
  can throw mid-enumeration, not just the supplier call itself.
- **All specs are jsdom** (`capture-state`, `capture-state-sanitize`, `with-qits-snapshot` via
  TestBed, `capture-payload` extensions) — nothing here needs a layout engine, so no new
  browser specs; the deferred E2E browser spec remains the integration follow-up.
- **The fixture demo store** is `GreetingHistoryStore` (root-provided, `withState({greetings:
  string[]})`, `withQitsSnapshot('greetingHistory')`): the greeting component `tap`s every
  answered greeting into it, on `main` with `feature/greeting` re-baked on top (still a clean
  fast-forward; `feature/diverged` untouched). Redaction stayed docs-only, stated in the
  library README with a projection example.
