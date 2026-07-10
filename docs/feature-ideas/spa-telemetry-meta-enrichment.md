# SPA telemetry meta-enrichment: route context, named interactions, request caller attribution

## Introduction

The [SPA observability](../features/2026-07-06_spa-observability.md) convention made browser
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
Telemetry tab's span drill-down already renders arbitrary attributes.

Related / dependent plans:

- **Extends [SPA observability](../features/2026-07-06_spa-observability.md)** — same decree
  document, same gate (`config.json` relay), same passthrough; this adds instrumentation richness
  on top. Its "user-interaction instrumentation" non-mention becomes this idea.
- **Consumes [observability](../features/2026-07-04_observability.md) unchanged** — receiver,
  decoder, store, MCP tools untouched; new attributes ride through and reach the agent's
  `telemetryErrors`/`telemetryTrace` tools for free.
- **Feeds [workspace observation tabs](../features/2026-07-06_workspace-observation-tabs.md)** —
  richer rows with zero UI change; *optional* later polish (route badge in the errors feed,
  interaction-named trace roots in Recent traces) would live there.
- **Modifies the [servable quarkus-angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — all code lands in `testing-repo-quarkus-angular.git` (`telemetry.ts`, `app.config.ts`, the
  greeting template, `package.json`), same branch procedure as before (commit on `main`, rebase
  `feature/greeting` to stay fast-forward, leave `feature/diverged` untouched).
- **Updates [the Quarkus/Angular integration guide](../guides/quarkus-angular-integration.md)** in
  the same change — the guide documents the convention's contract, and this extends it.
- **Adjacent to [picked-element component attribution](../features/2026-07-10_picked-element-component-attribution.md)**
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

## Demo payoff / acceptance

`seed-webapp` → greeting workspace → web view → Telemetry tab:

- Click the greet button → Recent traces shows a root span `interaction save-greeting`
  (`app.component=Greeting`) whose children are the browser `HTTP POST` (carrying
  `code.function=Greeting.submit`, `app.route.path=greeting/:name`) and the Quarkus server span —
  one trace from finger to database and back.
- Navigate to a different name → a `Navigation` span with `app.route.path=greeting/:name`,
  `app.navigation.result=success`; the initial load shows the redirect hop as its own navigation.
- Provoke the SPA error → the errors-feed entry carries `app.route.*`, answering "which page"
  without opening the stack.
- Standalone fixture run stays fully dark (unchanged gate); export self-instrumentation still
  excluded (the fetch wrapper is a no-op without an active span).

## Open questions

- **Opt-in vs capture-all interactions**: start capture-all (`click`,`submit`); flip to
  "only elements under a `data-track-event` ancestor" if unnamed clicks turn out to be noise.
- **Attribute naming**: `app.route.*` / `app.interaction.*` are custom — the browser/RUM semconv
  is still incubating upstream. Start custom (cheap to rename later); `code.*` follows the stable
  semconv today.
- **Copy the interaction name onto child fetch spans** (`app.interaction.name` downward)? Lean
  no — the trace structure already expresses it; flat span-list views could argue for it later.
- **`code.stacktrace` size**: keep the full filtered stack or cap at ~10 frames? Lean cap —
  telemetry rows are read in a narrow drill-down pane.
- **Does `shouldPreventSpanCreation` fire for `submit` targets as expected in the installed
  contrib version?** Verify at implementation; if the hook surface changed, the fallback is a
  document-level capture listener that enriches via `trace.getActiveSpan()`.
