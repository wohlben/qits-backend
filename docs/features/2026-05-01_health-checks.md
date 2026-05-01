# Health Checks

## Introduction

- Adds standard Kubernetes-compatible health probes (`/q/health/live`, `/q/health/ready`, `/q/health`).
- No dependent plans.

## Scope

- Add `quarkus-smallrye-health` dependency to `service/pom.xml`.
- Rely on built-in readiness/liveness checks provided by Quarkus (datasource, flyway, etc.).
- Add a regression test that verifies the health endpoint returns `UP`.

## Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/q/health` | Aggregated health status |
| `/q/health/live` | Liveness probe |
| `/q/health/ready` | Readiness probe |

## Implementation

1. Add `io.quarkus:quarkus-smallrye-health` to `service/pom.xml`.
2. Write `HealthCheckTest` under `service/src/test/java/.../health/`.
