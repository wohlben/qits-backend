# SPA telemetry meta-enrichment: route context, named interactions, request caller attribution

> **Update (2026-07-13):** this layer now ships inside the
> [`@qits/angular` library](https://github.com/wohlben/qits-angular-integration)
> ([qits-angular-integration-library](../../qits-integration-angular/features/2026-07-13_qits-angular-integration-library.md)) — apps
> get it from `provideQitsIntegration()`; the `data-track-event` decree stays the app's only
> touchpoint. This doc remains the design record.

## Introduction

The [SPA observability](2026-07-06_spa-observability.md) convention made browser
telemetry *flow* — document-load and fetch spans, error logs, one full-stack trace per API call.
But the data is thin on **meta-information**: a fetch span says `HTTP POST` and a URL, an error
log says what threw — neither says *where in the app* it happened. This idea adds three
enrichment tiers to the browser instrumentation, staying entirely within what the OTEL JS web SDK
supports today:

1. **Route context** — every span and log record carries the Angular route it happened on
   (`app.route.path` = the matched route pattern, e.g. `greeting/:name`), and route changes
   become spans of their own.
2. **Named interaction spans** — clicks/submits become spans via
   `@opentelemetry/instrumentation-user-interaction`, with a decreed framework-free DOM attribute
   (`data-track-event="save-greeting"`) for human-readable names, plus the owning Angular
   component. Synchronously-fired fetches nest under the interaction, so the trace root becomes
   the *user action*.
3. **Caller attribution on fetch spans** — semconv `code.function` / `code.filepath` /
   `code.stacktrace` captured from the call-site stack, answering "which file/method issued this
   request".

Like the parent feature, this is a **convention extension, not a qits feature**: instrumentation
remains the target app's business, the fixture is the reference implementation, and **qits ships
zero backend changes** — `TelemetryDecoder`/`TelemetryStore` are attribute-agnostic and the
Telemetry tab's span drill-down renders arbitrary attributes (the drill-down was made
attribute-rendering in
[telemetry trace detail omits span attributes](../../../issues/resolved/2026-07-11_telemetry-trace-detail-omits-span-attributes.md);
it previously showed kind/name/duration only).

Related / dependent plans:

- **Extends [SPA observability](2026-07-06_spa-observability.md)** — same decree
  document, same gate (`config.json` relay), same passthrough; this adds instrumentation richness
  on top. Its "user-interaction instrumentation" non-mention becomes this idea.
- **Consumes [observability](2026-07-04_observability.md) unchanged** — receiver,
  decoder, store, MCP tools untouched; new attributes ride through and reach the agent's
  `telemetryErrors`/`telemetryTrace` tools for free.
- **Feeds [workspace observation tabs](../../qits-workspace-detail/features/2026-07-06_workspace-observation-tabs.md)** —
  richer rows with zero UI change; *optional* later polish (route badge in the errors feed,
  interaction-named trace roots in Recent traces) would live there.
- **Modifies the [servable quarkus-angular fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — all code lands in `testing-repo-quarkus-angular.git` (`telemetry.ts`, `app.config.ts`, the
  greeting template, `package.json`), same branch procedure as before (commit on `main`, rebase
  `feature/greeting` to stay fast-forward, leave `feature/diverged` untouched).
- **Updates [the Quarkus/Angular integration guide](../../../guides/quarkus-angular-integration.md)** in
  the same change — the guide documents the convention's contract, and this extends it.
- **Adjacent to [picked-element component attribution](../../qits-workspace-detail/features/2026-07-10_picked-element-component-attribution.md)**
  — both answer "which component owns this DOM element". The picker resolves it qits-side from a
  source scan; interaction spans resolve it in-page via Angular's dev-mode `ng.getOwningComponent`.
  Same vocabulary (component names as meta-info), independent mechanisms.
- **Still not qits' own UI** — self-observability of the qits SPA remains a separate idea; "SPA"
  here is the observed workspace app's frontend. (Backend meta-enrichment — richer Quarkus-side
  spans — is likewise separate; the user-visible gap is worst browser-side, so frontend first.)

## The gap, concretely

`seed-webapp`, greeting workspace, web view open, Telemetry tab beside it:

- A browser fetch span says `HTTP POST` + URL. *Which component/method fired it?* Unknowable.
- The errors feed shows an exception with a stack. *What page was the user on?* Not recorded —
  and for a multi-route app the route is the first triage question.
- A user clicks a button and nothing visibly happens, no fetch, no error. There is **no telemetry
  at all** for the interaction itself — the agent investigating "the button does nothing" can't
  even confirm the click was registered.
- Route changes (the redirect component's `/` → `/greeting/world` hop, `:name` navigations) are
  invisible; SPA navigation is exactly the thing server-side telemetry can never see.

## Design

### 1. Route context (`app.route.*`)

Two halves — navigation spans and ambient stamping:

- **Navigation spans.** Router wiring needs the injector, so it can't live in the pre-bootstrap
  `initTelemetry()`: `telemetry.ts` exports a `provideRouteTelemetry()` (an
  `provideAppInitializer` that injects `Router`), registered in `app.config.ts`, no-op while
  telemetry is dark. `NavigationStart` opens a `Navigation` span; `NavigationEnd`/`Cancel`/`Error`
  closes it with `app.route.path` (the matched config path composed by walking
  `router.routerState.snapshot` — `greeting/:name`, not the concrete URL, so traffic groups
  without cardinality explosions), `app.route.url` (the concrete URL), and
  `app.navigation.result`. The redirect component's `replaceUrl` hop appears as its own
  navigation — truthful, and a nice demo of why the redirect exists.
- **Ambient stamping.** A custom `SpanProcessor.onStart` + `LogRecordProcessor.onEmit` stamp the
  *current* `app.route.path`/`app.route.url` onto **every** span and log record (tracked by the
  same router subscription; falls back to `location.pathname` before the first `NavigationEnd`,
  which covers `documentLoad`). The errors feed thereby answers "on which page" with no query
  change.

### 2. Interaction spans + `data-track-event` (the `trackButtonEvent` ask)

- Register `@opentelemetry/instrumentation-user-interaction` (contrib package, experimental like
  `instrumentation-document-load`; works without zone.js — the app stays zoneless) with
  `eventNames: ['click', 'submit']`.
- **The decree bit is a plain DOM attribute, not an Angular directive:**
  `data-track-event="save-greeting"` on any element. Framework-free (any framed app can adopt it;
  Angular templates pass static attributes through untouched), zero runtime cost, and readable in
  the template. The instrumentation's `shouldPreventSpanCreation(event, element, span)` hook —
  despite its name, the enrichment seam that receives the element and the just-created span —
  walks `element.closest('[data-track-event]')` and, when found, renames the span to
  `interaction save-greeting` and sets `app.interaction.name`. All interaction spans additionally
  get `app.interaction.target` (tag + id/text hint) and, when Angular's dev-mode global is
  present, `app.component` = `ng.getOwningComponent(element)?.constructor.name` (fixture-side
  sugar, not part of the decree — the decree stays framework-free).
- **The payoff is trace shape:** with the stack context manager, the handler's synchronous part
  runs inside the interaction span's context, so a fetch fired synchronously (including
  `HttpClient` + `withFetch()`, whose subscribe chain is synchronous down to `window.fetch`)
  becomes its **child**. The Recent-traces root changes from `HTTP POST` to
  `interaction save-greeting` → fetch → Quarkus server span. Honest limitation: zoneless +
  stack-based context means work after an `await`/`setTimeout` escapes the interaction context —
  those fetches surface as their own (still route-stamped) roots. Acceptable; we don't adopt
  zone.js for this.
- Volume stance: capture all clicks/submits — interaction telemetry is human-scale (a handful of
  events per minute), and unnamed spans still carry target + component.

### 3. Fetch caller attribution (`code.*`)

"From which file was the request executed" — via call-site stack capture, zero per-call friction:

- `initTelemetry()` installs a **thin `window.fetch` wrapper before registering
  `FetchInstrumentation`**, so the instrumentation's patch wraps *it* and it executes inside the
  just-started fetch span's context. The wrapper reads `trace.getActiveSpan()` (absent for the
  ignored OTLP-export URLs — self-excluding), captures `new Error().stack`, drops vendor frames
  (`@opentelemetry/`, Angular core chunks, the wrapper itself), and sets semconv
  `code.function` + `code.filepath` + `code.lineno` from the topmost app frame, plus a truncated
  `code.stacktrace`.
- **Honesty about resolution:** under `ng serve`, function/class names are unminified —
  `Greeting.submit` is the reliable, useful signal. File *paths* are served-bundle URLs
  (`main.js`, `chunk-*.js:line`), i.e. approximate; the full `code.stacktrace` compensates. Note
  also that with `HttpClient`'s cold observables the captured frame is the *subscriber* (usually
  the component method), not the service line that built the request — which matches what "who
  fired this request" means in practice.
- Alternative considered and parked: explicit per-call labels via an `HttpContext` token +
  interceptor — deterministic but opt-in friction at every call site; revisit only if bundle-URL
  paths prove annoying in real repos.

### What qits does: nothing

Attributes flow protobuf → `TelemetryDecoder` → `StoredSpan.attributes`/`StoredLog.attributes` →
span drill-down / errors feed / MCP tools, all existing code. If the enriched data proves its
worth, *display* polish (grouping the errors feed by `app.route.path`, badging interaction-rooted
traces) is a separate, later idea against the observation tabs.

## Touch points

All in the fixture repo (`domain/src/test/resources/fixtures/testing-repo-quarkus-angular`):

- `src/main/webui/package.json` — add `@opentelemetry/instrumentation-user-interaction` (contrib;
  pick the release line compatible with `instrumentation` 0.220.x / SDK 2.x, as was done for
  `instrumentation-document-load` 0.65).
- `src/main/webui/src/telemetry.ts` — fetch wrapper (`code.*`), user-interaction registration +
  enrichment hook, route-stamping span/log processors, exported `provideRouteTelemetry()`.
- `src/main/webui/src/app/app.config.ts` — register `provideRouteTelemetry()`.
- `src/main/webui/src/app/greeting.ts` — `data-track-event="save-greeting"` on the submit button
  (the reference usage).
- Fixture `CLAUDE.md` — extend the Observability paragraph.
- qits side: `docs/guides/quarkus-angular-integration.md` gains the three conventions;
  `seed-webapp` unchanged (the daemon `otel` toggle still gates everything).

## Implementation notes

Implemented 2026-07-11 (fixture commit `Enrich telemetry: route context, interaction spans,
fetch caller attribution` on `main`, `feature/greeting` rebased on top, `feature/diverged`
untouched). Deviations and empirical findings against the plan above:

- **The greeting component gained a form** — the plan's "`data-track-event` on the submit
  button" presumed an interactive control that didn't exist (the POST fired reactively off
  `paramMap`). And `router.navigate()` alone would not deliver the promised trace shape: router
  navigation is asynchronous, so a handler that only navigates loses the POST from the
  interaction span's stack context. The component now drives the POST from
  `merge(routeName, submittedName).pipe(distinctUntilChanged(), switchMap(http.post))`: a submit
  pushes the name **synchronously** (the POST nests under the interaction span), then navigates
  to keep the URL truthful; `distinctUntilChanged` swallows the `paramMap` echo, so one submit
  is exactly one POST. Deep links and back/forward still post via the route leg.
- **`data-track-event` sits on the `<form>`, not the button.** Verified in
  `instrumentation-user-interaction` 0.64.0 source: the element handed to
  `shouldPreventSpanCreation(eventName, element, span)` (note: event *name*, not event) is
  `event.target`, and a submit event's target is the form; `closest()` walks *up* from there.
  Decree wording: "on the event target or an ancestor".
- **Zoneless path verified in source**: without `window.Zone` the instrumentation patches
  `EventTarget.prototype.addEventListener`, runs the listener inside `context.with(span)` and
  ends the span synchronously on return — exactly the "synchronous work nests" model the design
  assumed. The `shouldPreventSpanCreation` hook fires for `submit` like any configured event.
- **Version and the zone.js peer:** latest contrib release is `0.64.0` (lags document-load's
  0.65 line; deps `instrumentation ^0.220.0` / `sdk-trace-web ^2.0.0` fit the fixture's set). It
  declares a **hard `zone.js` peer dep** it only actually uses when zone.js is present; pnpm
  10's auto-install-peers would have dragged zone.js into the lockfile
  (`peerDependencyRules.ignoreMissing` only silences the warning). Fixed with a pnpm
  `packageExtensions` entry marking the peer optional — the lockfile stays zone-free.
- **`code.*` uses today's stable semconv names** — `code.function.name`, `code.file.path`,
  `code.line.number` (the plan's `code.function`/`code.filepath`/`code.lineno` are the
  deprecated pre-stabilization ids; the stated intent was "follow the stable semconv").
- **`Error.stackTraceLimit` must be lifted around the capture** (restored after): V8's default
  is 10 frames, and the measured RxJS/HttpClient plumbing between `Greeting.submit` and
  `window.fetch` under `ng serve` is ~50 frames — with the default limit the app's caller never
  even enters the raw stack.
- **`VENDOR_FRAME` tuned against a live `ng serve` stack:** Angular's vite dev server serves
  dependencies under `/@fs/…/vite/deps/chunk-*.js` (one URL pattern catches all of RxJS/Angular/
  OTEL internals in dev), and esbuild decorates names (`_FetchBackend`, `Observable2`) — the
  name alternates tolerate `_` prefixes and digit suffixes, and a leading `_` is stripped from
  the reported `code.function.name` (`_Greeting.submit` → `Greeting.submit`). Verified: the
  submit-driven POST's topmost surviving frame is `Greeting.submit`; the route-driven POST
  attributes to the `toSignal` initializer (`<instance_members_initializer>` over
  `new _Greeting`) — the honest answer to "who subscribed".
- **Route stamping omits `app.route.path` before the first `NavigationEnd`** rather than faking
  it with the concrete URL (which would pollute the pattern attribute's grouping);
  `app.route.url` falls back to `location.pathname`, covering `documentLoad`.
- **`NavigationSkipped` is handled** (`app.navigation.result: skipped`) — the post-submit
  `router.navigate` to the same name triggers exactly this event.
- **Navigation spans root *unless* an interaction caused them** (a deviation from the plan's
  "root spans" stance, discovered in the E2E pass and kept): the span starts in the ambient
  context, and a `router.navigate` fired synchronously from a handler runs inside the
  interaction span's context — so the submit's navigation nests under
  `interaction save-greeting`, keeping cause and effect in one trace. Load-time and redirect
  navigations still root.
- **Two frame-hygiene fixes only the E2E surfaced:** the `captureStack` helper is itself the
  topmost stack frame (it, not just `attributedFetch`, must be in `VENDOR_FRAME` — without it
  every fetch span said `code.function.name=captureStack`), and `ng.getOwningComponent`
  returns the esbuild-aliased class (`_Greeting`) — the leading underscore is stripped for
  `app.component` like for `code.function.name`.

## Demo payoff / acceptance

`seed-webapp` → greeting workspace → web view → Telemetry tab (submitting the greeting form
stands in for the plan's "greet button"):

- Submit the form → Recent traces shows a root span `interaction save-greeting`
  (`app.component=Greeting`) whose children are the browser `HTTP POST` (carrying
  `code.function.name=Greeting.submit`, `app.route.path=greeting/:name`) and the Quarkus server
  span — one trace from finger to database and back.
- Navigate to a different name → a `Navigation` span with `app.route.path=greeting/:name`,
  `app.navigation.result=success`; the initial load shows the redirect hop as its own navigation.
- Provoke the SPA error → the errors-feed entry carries `app.route.*`, answering "which page"
  without opening the stack.
- Standalone fixture run stays fully dark (unchanged gate); export self-instrumentation still
  excluded (the fetch wrapper is a no-op without an active span).

## Open questions (all resolved at implementation)

- **Opt-in vs capture-all interactions**: capture-all (`click`,`submit`), as leaned — interaction
  telemetry is human-scale; flip to "only under a `data-track-event` ancestor" if unnamed clicks
  ever turn out to be noise.
- **Attribute naming**: `app.route.*` / `app.interaction.*` stay custom (browser/RUM semconv
  still incubating); `code.*` follows the **stable** semconv — which meant `code.function.name`/
  `code.file.path`/`code.line.number`, not the deprecated short forms this plan originally named.
- **Copy the interaction name onto child fetch spans**: no, as leaned — the trace structure
  expresses it.
- **`code.stacktrace` size**: capped at 10 filtered frames, as leaned.
- **Does `shouldPreventSpanCreation` fire for `submit`?** Yes — verified in 0.64.0 source
  (`submit` goes through the same generic `_createSpan` path as `click`); the fallback listener
  was not needed. The hook's first parameter is the event *name* string, and the element is
  `event.target` — which is why the decree attribute lives on the form.

## Testing

- **qits side: nothing added** — the enriched attributes ride the existing decoder/store/UI
  paths; `domain` (308) and `cli` (incl. `SeedWebappServiceTest`) suites green against the
  updated fixture (branch names only, no hash assertions).
- **Fixture (its own repo, not the qits build):** `./mvnw test` (8 tests) and `./mvnw package`
  (Quinoa production Angular build) green; `pnpm build` + prettier clean.
- **Verified E2E (seed-webapp loop, 2026-07-11, devcontainer):** submitting the greeting form
  with a new name produced one trace — root `interaction save-greeting`
  (`app.component=Greeting`, `app.interaction.target=form "Name Greet"`, `app.route.*`) →
  browser `HTTP POST` (`code.function.name=Greeting.submit`, `code.line.number`, capped
  `code.stacktrace`, `app.route.path=greeting/:name`) → Quarkus `POST /greetings` SERVER span,
  plus the submit's `Navigation` (`success`, `/greeting/Telemetry`) nested under the
  interaction. The initial load showed `/` and the redirect hop `/greeting/world` as their own
  root `Navigation` spans. A provoked uncaught browser error appeared in the errors feed
  carrying `app.route.path`/`app.route.url` alongside `exception.*`. Zero `POST /otel/v1/…`
  self-spans. The `distinctUntilChanged` echo-suppression held: one submit, exactly one POST.
