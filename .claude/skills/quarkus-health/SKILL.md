---
name: quarkus-health
description: >
  Add and use the Quarkus SmallRye Health extension (quarkus-smallrye-health)
  for Kubernetes-compatible liveness, readiness, startup, and wellness probes.
  Use this skill when the user asks to add health checks, custom health
  indicators, or verify application health endpoints.
---

# Quarkus SmallRye Health Skill

## What is `quarkus-smallrye-health`?

The SmallRye Health extension implements the **MicroProfile Health** specification for Quarkus. It exposes standard HTTP endpoints that Kubernetes (and other orchestrators) use as health probes.

- **No custom REST resources needed** — endpoints are auto-registered by Quarkus.
- **Built-in checks** — automatically included for datasource, Flyway, messaging, cache, etc.
- **Custom checks** — implement `HealthCheck` for application-specific logic.

## Adding the Extension

Add the dependency to `service/pom.xml` inside the `<dependencies>` block:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-health</artifactId>
</dependency>
```

No version is required — the Quarkus BOM manages it.

## Auto-Exposed Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/q/health` | Aggregated health (all checks combined) |
| `/q/health/live` | Liveness probe |
| `/q/health/ready` | Readiness probe |
| `/q/health/started` | Startup probe |
| `/q/health/well` | Wellness probe (optional, not part of MP spec) |

All return `200 OK` with `Content-Type: application/json` when healthy, or `503 Service Unavailable` when unhealthy.

Example response:
```json
{
  "status": "UP",
  "checks": [
    {
      "name": "Database connections health check",
      "status": "UP"
    }
  ]
}
```

## Built-In Checks

Quarkus automatically registers health checks for many extensions when they are present on the classpath:

| Extension | Check Type | Description |
|-----------|-----------|-------------|
| `quarkus-jdbc-*` / Agroal | Readiness | Datasource pool validation |
| `quarkus-flyway` | Readiness | Migration completion |
| `quarkus-hibernate-orm` | Readiness | Schema validation (optional) |
| `quarkus-kafka` | Liveness / Readiness | Consumer / producer health |
| `quarkus-redis` | Readiness | Redis connectivity |
| `quarkus-mongodb` | Readiness | MongoDB connectivity |

> **Tip:** Remove an unwanted built-in check by disabling its config property (see Quarkus docs for the specific extension).

## Writing Custom Health Checks

Create a CDI bean implementing `HealthCheck` and annotate it with the probe type.

### Readiness Check

```java
package eu.wohlben.qits.health;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;

@Readiness
@ApplicationScoped
public class MyServiceReadinessCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        boolean healthy = checkMyService();
        if (healthy) {
            return HealthCheckResponse.up("my-service");
        }
        return HealthCheckResponse.down("my-service");
    }

    private boolean checkMyService() {
        // application-specific validation
        return true;
    }
}
```

### Liveness Check

```java
package eu.wohlben.qits.health;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Liveness;

@Liveness
@ApplicationScoped
public class MyServiceLivenessCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.up("my-service-alive");
    }
}
```

### Startup Check

```java
import org.eclipse.microprofile.health.Startup;

@Startup
@ApplicationScoped
public class MyStartupCheck implements HealthCheck {
    @Override
    public HealthCheckResponse call() {
        return HealthCheckResponse.up("my-service-started");
    }
}
```

### Health Check with Data

```java
@Override
public HealthCheckResponse call() {
    return HealthCheckResponse.named("queue-depth")
        .up()
        .withData("depth", queue.size())
        .withData("max", 1000)
        .build();
}
```

## Testing Health Endpoints

Use `io.restassured` in `@QuarkusTest` classes. Example test for this project:

```java
package eu.wohlben.qits.health;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.is;

@QuarkusTest
public class HealthCheckTest {

    @Test
    public void healthEndpointReturnsUp() {
        given()
            .when()
            .get("/q/health")
            .then()
            .statusCode(200)
            .body("status", is("UP"));
    }

    @Test
    public void livenessEndpointReturnsUp() {
        given()
            .when()
            .get("/q/health/live")
            .then()
            .statusCode(200)
            .body("status", is("UP"));
    }

    @Test
    public void readinessEndpointReturnsUp() {
        given()
            .when()
            .get("/q/health/ready")
            .then()
            .statusCode(200)
            .body("status", is("UP"));
    }
}
```

> **Note:** When testing readiness with datasource/Flyway, Quarkus DevServices will start a test database automatically, so the readiness check passes without extra setup.

## Configuration

Optional `application.properties` tweaks:

```properties
# Change the root path for all health endpoints (default is /q/health)
# quarkus.smallrye-health.root-path=/health

# Disable specific built-in checks
# quarkus.datasource.health.enabled=false
# quarkus.flyway.enabled=false

# Enable wellness endpoint (disabled by default)
# quarkus.smallrye-health.wellness.enabled=true
```

## Rules & Conventions

- **Place custom checks** under `service/src/main/java/eu/wohlben/qits/health/`.
- **Place health tests** under `service/src/test/java/eu/wohlben/qits/health/`.
- Use `@ApplicationScoped` (or `@Singleton`) on health-check beans so CDI picks them up.
- Keep health-check logic **lightweight** — probes are called frequently by Kubernetes.
- If a check can fail temporarily, prefer marking it `@Readiness`; use `@Liveness` only for fatal/unrecoverable states.
- Document any new custom health checks in `docs/features/` or `docs/feature-ideas/` following the project's AGENTS.md conventions.

## Common Commands

```bash
# Run only health tests
./mvnw -pl service test -Dtest=HealthCheckTest -DfailIfNoTests=false

# Start dev mode and curl health endpoints
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true
curl -s http://localhost:8080/q/health | jq .
curl -s http://localhost:8080/q/health/ready | jq .
```

## External References

- **Quarkus Health Guide**: https://quarkus.io/guides/smallrye-health
- **MicroProfile Health Spec**: https://github.com/eclipse/microprofile-health
- **Quarkus Config Reference**: https://quarkus.io/guides/smallrye-health#configuration-reference
