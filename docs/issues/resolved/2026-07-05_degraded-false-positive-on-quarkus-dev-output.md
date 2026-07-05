# Healthy Quarkus dev daemon flips to DEGRADED on a benign telemetry WARNING — RESOLVED

## Resolution (2026-07-05)

Resolved on both layers. **Layer 1 (root cause):** the OTLP endpoint is now bridged into Quarkus
config, so telemetry exports successfully and the "Failed to export" WARNING never fires — see
[quarkus-otel-endpoint-not-bridged](2026-07-05_quarkus-otel-endpoint-not-bridged.md). **Layer 2
(hardening):** `LogLevelClassifier` now trusts a line's explicit level token, so a WARNING mentioning
"error" can no longer be escalated to ERROR. Verified: the greeting daemon reaches **READY and holds
it**, telemetry flows, and the only findings are genuine WARNINGs (Quinoa deprecation notices), which
do not degrade. (The classifier change is in the `domain` module; it goes live on the next qits
dev-server restart — the live fix that stopped the DEGRADED was Layer 1.)

## Introduction

Found while diagnosing why the `seed-webapp` "Quarkus dev server"
[daemon](../../features/2026-07-04_daemons.md) showed DEGRADED after the
[workspace-image build fix](../2026-07-05_workspace-image-cannot-build-fixture.md). Concerns the
[daemons](../../features/2026-07-04_daemons.md) `LogLevelClassifier` and, upstream of it, the
[observability](../../features/2026-07-04_observability.md) OTLP wiring for the
[Quarkus+Angular fixture](../../features/2026-07-05_servable-quarkus-angular-fixture.md). See the
related [OTEL-endpoint issue](2026-07-05_quarkus-otel-endpoint-not-bridged.md).

## Observed

Once the image was fixed, the `greeting` daemon started cleanly and reached `READY` ("Listening on"
matched), then within ~5s went `DEGRADED` — while the server stayed alive and served HTTP 200 through
the qits web-view proxy. Every ~2s an `ERROR_DETECTED` event fired. `DEGRADED` does not auto-recover
(by design), so a healthy dev server sits permanently DEGRADED — reading as "something is wrong" for
the flagship demo.

## Root cause (two layers)

**Layer 1 — a real telemetry failure is being logged (a WARNING).** The daemon has `otel=true`, so
qits injects `OTEL_EXPORTER_OTLP_ENDPOINT=http://<host>:<port>/api/otel`. But Quarkus OpenTelemetry
does **not** read that generic OTel-SDK env var, so the app exports to its own default
`http://localhost:4317`, which nothing is listening on inside the container. Quarkus logs, every
export cycle:

```
… WARNING [io.quarkus.opentelemetry.runtime.exporter.otlp.sender.VertxHttpSender] (vert.x-eventloop-thread-8) Failed to export. … Full error message: Connection refused: localhost/127.0.0.1:4317
```

That is a genuine (separate) bug — see
[quarkus-otel-endpoint-not-bridged](2026-07-05_quarkus-otel-endpoint-not-bridged.md). Fixing it makes
the WARNING disappear entirely.

**Layer 2 — the classifier escalated that WARNING to ERROR.** `LogLevelClassifier.ERROR_SIGNAL`
matched the case-insensitive word "error" inside the message ("Full **error** message"), classifying a
line whose own declared level is `WARNING` as `ERROR`. Only `ERROR`-severity findings drive DEGRADED
(`DaemonSupervisor` — `status == READY && severity == ERROR`), so a benign telemetry warning flipped
the daemon. (The PTY frame-joining that glued the dev-console banner onto the WARNING line made the
excerpt even more confusing, but the trigger is the "error" keyword.)

## Fix applied (Layer 2)

`LogLevelClassifier` now **trusts an explicit level token**: a line carrying a standalone uppercase
level field (`WARNING`, `INFO`, `ERROR`, JUL `SEVERE`/`FINE`, syslog `CRITICAL`/`NOTICE`, …) is
classified by *that* level, and an incidental "error"/exception keyword in the message can no longer
upgrade a `WARNING`/`INFO` line to `ERROR`. Only lines with **no** explicit level fall back to the
previous keyword / exception-name / traceback heuristics (so unstructured lowercase `error:` output is
still caught). Regression tests added in `ObserverSinkTest`
(`logLevelClassifierReadsTheSeverityVocabularyLogsCarry`): the Quarkus telemetry line → `WARNING`; an
`INFO …TimeoutException` line → quiet. A `WARNING`-severity finding does not degrade a daemon, so the
dev server now stays `READY` even while telemetry export is failing.

> Deploy note: the classifier is in the `domain` module. The running `quarkus:dev` did **not**
> hot-reload the change in place — restart the qits dev server to pick it up (kill + `./mvnw install`
> + restart, per the dev-mode caveat).

## Follow-up (Layer 1)

Bridging the OTLP endpoint into Quarkus config so telemetry actually exports (and the WARNING never
fires) is tracked separately in
[quarkus-otel-endpoint-not-bridged](2026-07-05_quarkus-otel-endpoint-not-bridged.md). With Layer 2
fixed, that failure is now correctly surfaced as a WARNING rather than wedging the daemon.
