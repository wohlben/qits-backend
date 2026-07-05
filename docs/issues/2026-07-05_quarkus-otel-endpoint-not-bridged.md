# Quarkus fixture ignores the injected OTLP endpoint — telemetry export fails

## Introduction

Found while diagnosing the [DEGRADED false-positive](2026-07-05_degraded-false-positive-on-quarkus-dev-output.md)
on the `seed-webapp` "Quarkus dev server" daemon. Concerns the
[observability](../features/2026-07-04_observability.md) OTLP injection
(`OtelEnvironment`/`QitsHostResolver`) and the
[Quarkus+Angular fixture](../features/2026-07-05_servable-quarkus-angular-fixture.md) app config.

## Observed

With `otel=true`, the greeting dev server logs, every export cycle:

```
WARNING [io.quarkus.opentelemetry.runtime.exporter.otlp.sender.VertxHttpSender] Failed to export.
  … Full error message: Connection refused: localhost/127.0.0.1:4317
```

So no traces/logs/metrics reach the qits `/api/otel` receiver — the observability panel for this
worktree stays empty.

## Root cause

qits injects the environment correctly. Confirmed inside the running dev JVM (pid of the forked
`quarkus-angular-dev.jar`):

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://192.168.152.4:8080/api/otel   # container-reachable qits host
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=Quarkus dev server
OTEL_RESOURCE_ATTRIBUTES=qits.worktree.id=greeting,…
```

and that endpoint **is reachable** from the container (`POST …/api/otel` → HTTP 405, i.e. the receiver
answers — not connection-refused). The problem is that **Quarkus OpenTelemetry does not consume the
generic OTel-SDK `OTEL_*` environment variables.** Quarkus is configured via its own
`quarkus.otel.*` keys (env form `QUARKUS_OTEL_*`); the SDK autoconfig that reads `OTEL_EXPORTER_OTLP_*`
is off. So `quarkus.otel.exporter.otlp.endpoint` keeps its default `http://localhost:4317` and the
injected value is ignored.

The fixture's `application.properties` encodes the wrong assumption (comment: "The OTLP endpoint … are
injected by qits at daemon launch (OTEL_EXPORTER_OTLP_* env), so only the protocol is pinned here").
The env is injected, but Quarkus never reads it.

## Suggested fix direction

**Fixture-local (preferred):** bridge the injected env var into a Quarkus config key so Quarkus reads
it, in `testing-repo-quarkus-angular` `src/main/resources/application.properties`:

```properties
# Quarkus doesn't read the generic OTEL_* SDK env vars; bridge the qits-injected endpoint explicitly.
quarkus.otel.exporter.otlp.endpoint=${OTEL_EXPORTER_OTLP_ENDPOINT:http://localhost:4317}
```

(Optionally also `…otlp.protocol=${OTEL_EXPORTER_OTLP_PROTOCOL:http/protobuf}`, though the protocol is
already pinned.) This is a fixture change, so it must be committed on the fixture branches that run the
daemon (`main` and `feature/greeting`) in the committed bare repo — preserving the branch invariants
(`feature/greeting` fast-forwardable over `main`, `feature/diverged` conflicting) — and then the
running demo re-seeded (`cli … seed-webapp`, which is reset-idempotent) so the greeting worktree gets
the fixed app.

**qits-side alternative (rejected):** having `OtelEnvironment` also emit `QUARKUS_OTEL_*` would leak a
framework-specific assumption into the deliberately framework-agnostic injector; the standard `OTEL_*`
names are correct for SDK-based consumers (incl. the coding agent). The Quarkus app is the odd one that
must opt in — so the bridge belongs in the fixture.

## Not yet done

Only the classifier half (so this failure no longer wedges the daemon into DEGRADED) is fixed. This
endpoint bridge + re-seed is left as a deliberate follow-up because it touches the multi-branch
committed fixture and requires regenerating it.
