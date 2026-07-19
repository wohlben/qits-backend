# Backend telemetry meta-enrichment: handler attribution on server spans + `@WithSpan` depth

## Introduction

The backend sibling of
[SPA telemetry meta-enrichment](2026-07-11_spa-telemetry-meta-enrichment.md). Quarkus's automatic
instrumentation produces exactly one span per request — `POST /greetings`, HTTP semconv
attributes, nothing else. Which **class handled it**, which **method**, which **file** — absent;
and the trace has no interior (no spans for the business methods the handler called). This idea
enriches the Quarkus side with the same `code.*` vocabulary the frontend idea uses, in two tiers:

1. **Handler attribution on the existing server span** — a JAX-RS request filter resolves the
   matched resource (`ResourceInfo`) and stamps `code.namespace` (FQCN), `code.function` (method
   name) and a derived, workspace-relative `code.filepath`
   (`src/main/java/<pkg-path>/<TopLevelClass>.java`) onto the current server span.
2. **Business-method depth via `@WithSpan`** — Quarkus supports
   `io.opentelemetry.instrumentation.annotations.WithSpan` / `@SpanAttribute` /
   `@AddingSpanAttributes` on any CDI bean method out of the box (the annotations ship with
   `quarkus-opentelemetry`, zero new dependencies). The decree: annotate the meaningful internal
   seams so traces get an interior — `GreetingResource.greet` → `GreetingService.compose` instead
   of one flat server span.

Like its sibling, this is a **convention extension, not a qits feature**: instrumentation is the
target app's business, the fixture is the reference implementation, and qits ships **zero
changes** — the decoder/store are attribute-agnostic and the span drill-down already renders
arbitrary attributes.

Related / dependent plans:

- **Sibling of [SPA telemetry meta-enrichment](2026-07-11_spa-telemetry-meta-enrichment.md)** — together
  they make the full-stack trace source-addressed at every hop: browser fetch span
  (`code.function=Greeting.submit`) → server span (`code.filepath=src/main/java/…/
  GreetingResource.java`) → `GreetingService.compose`. The two should agree on `code.*` key
  naming (see open questions) and ideally land around the same time.
- **Extends the [observability](2026-07-04_observability.md) feature's env-var half**
  — the backend telemetry that pipeline already collects gets richer; receiver, decoder, store,
  MCP tools all unchanged. The agent's `telemetryTrace` tool now returns spans that name their
  source files — directly actionable for a coding agent.
- **Feeds [workspace observation tabs](../../qits-workspace-detail/features/2026-07-06_workspace-observation-tabs.md)** —
  richer drill-downs with zero UI change.
- **Modifies the [servable quarkus-angular fixture](../../qits-testing-fixtures/features/2026-07-05_servable-quarkus-angular-fixture.md)**
  — all code lands in `testing-repo-quarkus-angular.git`; same branch procedure (commit on
  `main`, rebase `feature/greeting` fast-forward, `feature/diverged` untouched).
- **Updates [the Quarkus/Angular integration guide](../../../guides/quarkus-angular-integration.md)**
  in the same change.
- **Possible later synergy with the [workspace file browser](../../qits-workspace-detail/features/2026-07-02_workspace-file-browser.md)**
  — `code.filepath` is deliberately derived *workspace-relative*, so a later display polish could
  deep-link a span's attribute straight into the Files tab (the same move
  [picked-file deep links](../../qits-workspace-detail/features/2026-07-10_workspace-tab-url-and-picked-file-deep-link.md) made for picks). Out
  of scope here; noted so the path format is chosen with that in mind.

## The gap, concretely

`seed-webapp`, greeting workspace, daemon `otel` on, post a greeting, open the trace drill-down:

- The server span says `POST /greetings` with HTTP attributes (route, status, method). *Which
  code handled it?* Nothing points at `GreetingResource.greet`. In the two-class fixture you can
  guess; in a real repo the route→handler mapping is exactly what a reader (or the workspace
  agent) has to reconstruct by grepping.
- The trace has no interior: whatever the handler did — service calls, composition, (in a real
  app) repositories — is invisible between "request in" and "response out". Slow-span analysis
  (`telemetrySlowSpans`) can only ever indict the whole endpoint.
- The official Quarkus guide confirms the automatic server spans carry no code-location
  attributes; enrichment is explicitly the app's job (manual `Tracer`, `@WithSpan`, CDI
  customization beans are the offered seams).

## Design

### 1. Handler attribution: `TelemetryMetaFilter`

A `@Provider ContainerRequestFilter` (post-matching by default, so the resource is resolved) in
the fixture backend:

- Injects `jakarta.ws.rs.container.ResourceInfo`; reads `getResourceClass()` /
  `getResourceMethod()`.
- Guards on `Span.current().getSpanContext().isValid()` && `isRecording()` — requests on the
  suppress list (the OTLP passthrough) or with the SDK off are untouched.
- Stamps onto the **current server span** (no new span):
  - `code.namespace` = FQCN (`eu.wohlben.qits.testingrepo.GreetingResource`)
  - `code.function` = method name (`greet`)
  - `code.filepath` = `src/main/java/` + package path + top-level class + `.java`
    (`getEnclosingClass()`-walk for nested classes) — a standard-Maven-layout derivation, i.e. a
    convention-strength guess, but it is *the* layout for Quarkus apps and it matches what the
    workspace Files tab displays. Wrong-by-construction for generated/Kotlin/multi-source-root
    handlers; acceptable, it's meta-data not control flow.
- `code.lineno` is **omitted**: method line numbers aren't reachable via reflection, and parsing
  `LineNumberTable` debug info is far past fixture weight. The class+method+file triple is the
  actionable part.

Why a filter rather than `@WithSpan` on resource methods: annotating handlers would mint a
*second* span duplicating the server span one level down; the filter enriches the span Quarkus
already made, keeping one span per request. And it's write-once — every resource in the app gets
attribution without per-method ceremony (the passthrough/config resources included, which is
correct: their spans are suppressed anyway or equally deserve attribution).

### 2. Trace interior: `@WithSpan` on business seams

- The decree: annotate meaningful internal methods with `@WithSpan`, tag the interesting
  parameters with `@SpanAttribute("…")`, and use `@AddingSpanAttributes` where a method should
  enrich its caller's span without minting its own. Quarkus creates the spans and parents them
  correctly on any CDI bean, no agent needed.
- The fixture gains its first (deliberately tiny) service bean to make this demonstrable:
  `GreetingService` with
  `@WithSpan Greeting compose(@SpanAttribute("greeting.name") String name)` — moving the
  `Instant.now()` composition out of the resource. One class, no new dependencies; the resource
  stays a thin boundary, which incidentally makes the fixture *more* shaped like qits itself
  (boundary/control), not less minimal in any way that matters.
- Resulting trace: browser interaction → browser `HTTP POST` → server `POST /greetings`
  (`code.*` from tier 1) → `GreetingService.compose` (`greeting.name=world`). The
  `telemetrySlowSpans` tool can now separate handler overhead from business time.

### 3. Verify, don't build: log-record source info

JBoss log records already know their source class/method/line, and Quarkus's OTLP log signal
(`quarkus.otel.logs.enabled=true`, already on in the fixture) may map them to log-record
attributes. At implementation, check what the log tail actually receives; if source info is
already there, the guide documents it (and the errors feed gets file/method context for free); if
not, that's an upstream gap we note, not something the fixture should hand-roll.

## Touch points

Fixture repo (`domain/src/test/resources/fixtures/testing-repo-quarkus-angular`):

- `src/main/java/eu/wohlben/qits/testingrepo/TelemetryMetaFilter.java` — new, tier 1.
- `src/main/java/eu/wohlben/qits/testingrepo/GreetingService.java` — new, tier 2.
- `src/main/java/eu/wohlben/qits/testingrepo/GreetingResource.java` — inject/delegate to the
  service.
- Fixture `CLAUDE.md` — extend the Observability paragraph.
- Fixture tests: `GreetingResourceTest` stays green (behavior unchanged); a
  `TelemetryMetaFilterTest` unit-tests the `code.filepath` derivation (nested class, default
  package edge). Span-level assertions need the SDK on (the `%test` profile disables it to stop
  collector retries) — a dedicated `@TestProfile` re-enabling the SDK with an in-memory
  `SpanExporter` CDI bean is the clean option; if that fights the fixture's
  dependency-light stance, the E2E seed-webapp loop covers it (as the parent feature did).

qits side: `docs/guides/quarkus-angular-integration.md` gains the convention; nothing else.

## Demo payoff / acceptance

`seed-webapp` → greeting workspace → web view → post a greeting → Telemetry tab:

- The `POST /greetings` server span carries `code.namespace`, `code.function=greet`,
  `code.filepath=src/main/java/eu/wohlben/qits/testingrepo/GreetingResource.java`.
- Its child `GreetingService.compose` span carries `greeting.name` with the posted name.
- The OTLP passthrough (`/api/otel/v1/*`) stays span-free (suppress list) and the filter's guard
  keeps it untouched.
- With the frontend sibling also landed: one trace whose every hop names its source location.

## Open questions

- **`code.*` key generation**: stable semconv has migrated from
  `code.namespace`/`code.function`/`code.filepath` to
  `code.function.name` (fully-qualified)/`code.file.path`/`code.line.number`. Pick one
  generation and use it in **both** this and the frontend sibling — decide at implementation
  against the semconv version the toolchain ships; the drill-down renders either.
- **Does the installed `quarkus-opentelemetry` already stamp any `code.*`?** The guide says no
  and observation agrees, but verify against the fixture's actual Quarkus version first — if it
  gained them upstream, tier 1 reduces to the `code.filepath` derivation.
- **Filter placement**: `ContainerRequestFilter` vs Quarkus-native `@ServerRequestFilter` —
  cosmetic; take whichever reads better with `ResourceInfo` injection.
- **Should tier 1 also set the span name** to `ClassName.method`? Lean no — `POST /greetings`
  follows HTTP semconv and groups by route; the handler is an attribute, not an identity.
- **How far does the `@WithSpan` decree reach in a real app?** The guide should phrase it as
  "boundary→control seams and anything worth timing", not "every method" — span-per-method is
  noise. The fixture demonstrates exactly one.

## Implementation notes

Landed as planned, with the open questions resolved as follows (each verified against the
`quarkus-opentelemetry` 3.37.1 artifacts the fixture actually resolves, not the docs):

- **`code.*` keys follow today's stable semconv**, matching what the SPA sibling actually stamps:
  `code.function.name` (fully qualified — FQCN + `.` + method, replacing the plan's separate
  `code.namespace`/`code.function`) and `code.file.path`. The constants come from
  `io.opentelemetry.semconv.CodeAttributes` (`opentelemetry-semconv`, already transitive). No
  line number, as planned.
- **Quarkus does not stamp any `code.*` on server spans** — confirmed by inspecting the 3.37.1
  runtime: the only `CodeAttributes` use is in the log handler (next bullet). Tier 1 was needed.
- **Filter placement**: the Quarkus-native form won — a plain class with one
  `@ServerRequestFilter` method taking `org.jboss.resteasy.reactive.server.SimpleResourceInfo`
  (post-matching by default; classes with such methods auto-register, no `@Provider`).
  `SimpleResourceInfo` beats JAX-RS `ResourceInfo`: no reflective `Method` lookup, and its
  no-match contract is an explicit null `getResourceClass()` — the 404 guard.
- **Span name untouched**, as leaned — the handler is an attribute, not an identity.
- **Tier 3 resolved: log-record source info is already shipping upstream.** Quarkus's
  `OpenTelemetryLogHandler` stamps `code.function.name` (source class + method),
  `code.line.number`, `log.logger.namespace` and `thread.*` onto every exported log record. There
  is no `code.file.path` (a JUL `LogRecord` has no source file) — noted as the upstream gap; the
  guide documents the free attribution, nothing hand-rolled.
- **`GreetingResponse` is gone**: `GreetingService.Greeting` carries the identical JSON shape
  (`name`, `timestamp`), so the resource returns it directly and the wire contract (and
  `GreetingResourceTest`) is unchanged.
- **Span-level test with zero new dependencies** (`TelemetrySpansTest`): the `%test` profile
  disables the SDK, so a `@TestProfile` re-enables it with `quarkus.otel.exporter.otlp.enabled=
  false` (build-time, legal under re-augmentation — keeps the composite exporter from retrying a
  nonexistent collector), `quarkus.otel.bsp.schedule.delay=100ms` (the batch processor's 5 s
  default outlasts any sane poll), and logs/metrics off. The exporter is a ~15-line nested
  `@ApplicationScoped @Unremovable` in-memory `SpanExporter` — picked up because the default
  `quarkus.otel.traces.exporter=cdi` composes every CDI `SpanExporter` bean; inert in other
  profiles where the SDK is off. A hand-rolled deadline poll replaces awaitility (deliberately
  not on the fixture's test classpath). The test proves the whole chain: `Span.current()` in the
  filter *is* the server span, and `GreetingService.compose` parents under it carrying
  `greeting.name`.
- The path derivation is a package-private static (`TelemetryMetaFilter.sourceFilePath`) so
  `TelemetryMetaFilterTest` covers the nested-class walk and the default-package edge (probe
  class reached via `Class.forName` — the default package can't be imported) as plain JUnit.

## Testing

- Fixture: `./mvnw test` green — 12 tests (existing 8 + 3 path-derivation + the span test).
- qits: `domain` (308) and `cli` (3, incl. `SeedWebappServiceTest`) suites green after the
  fixture push, cache bypassed.
- E2E (`seed-webapp` → greeting workspace → daemon `otel` on → web-view greeting →
  `telemetry/traces/{traceId}`): one trace, browser CLIENT `HTTP POST`
  (`code.function.name=<instance_members_initializer>`, the SPA sibling's attribution) → SERVER
  `POST /greetings` with `code.function.name=eu.wohlben.qits.testingrepo.GreetingResource.greet`
  and `code.file.path=src/main/java/eu/wohlben/qits/testingrepo/GreetingResource.java` → INTERNAL
  `GreetingService.compose` with `greeting.name=world` (Quarkus adds `code.function.name` to
  `@WithSpan` spans by itself). Zero `POST /otel/v1/…` spans among 94. Tier-3 confirmed live: a
  backend log record arrived with `code.function.name=…ConfigDiagnostic.deprecated` and
  `code.line.number=83`.
- **Caveat found during E2E** (since resolved): the acceptance criterion "the drill-down shows the
  attributes" was wrong as written — the Telemetry tab's trace detail deliberately rendered
  kind/name/duration only, so the enrichment was visible via the trace API and the agent's
  `telemetryTrace` MCP tool but not in the UI. Filed as
  [telemetry trace detail omits span attributes](../../../issues/resolved/2026-07-11_telemetry-trace-detail-omits-span-attributes.md)
  and fixed there: span rows and log rows are now expandable disclosures that render the attribute
  map, so the `code.*` / `greeting.*` enrichment is visible in the Telemetry tab.
