# Mutiny Reactive Programming

## Introduction

- Adds explicit [Quarkus Mutiny](https://quarkus.io/guides/mutiny-primer) support as the reactive programming foundation.
- Required for future WebSocket features and other asynchronous operations.
- Related to future plans for WebSocket support and reactive data streaming.

## Scope

- Add `quarkus-mutiny` dependency explicitly to `service/pom.xml` (already available transitively via `quarkus-rest-jackson`).
- Add `quarkus-smallrye-context-propagation` to enable CDI, REST, and transaction context across async boundaries.
- Distill a project skill documenting common Mutiny patterns and context propagation.
- Add a smoke test verifying `Uni` and `Multi` behavior in the Quarkus runtime.
- Add a reactive echo controller demonstrating RESTEasy Reactive's built-in `Uni` support.
- Add a context propagation controller demonstrating `@RequestScoped` state survives Mutiny chains.

## Dependencies

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-mutiny</artifactId>
</dependency>
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-smallrye-context-propagation</artifactId>
</dependency>
```

## Key Patterns

### Uni — single result (0 or 1)

```java
Uni.createFrom().item("hello")
    .onItem().transform(String::toUpperCase)
    .onItem().transformToUni(v -> asyncOperation(v))
    .onFailure().recoverWithItem("fallback");
```

### Multi — stream of items

```java
Multi.createFrom().items("a", "b", "c")
    .onItem().transform(String::toUpperCase)
    .collect().asList();
```

### REST endpoint returning Uni

Quarkus REST (RESTEasy Reactive) automatically subscribes when a resource method returns `Uni<T>` or `Multi<T>`:

```java
@GET
public Uni<String> hello() {
    return Uni.createFrom().item("hello");
}
```

## Context Propagation

SmallRye Context Propagation captures `ThreadLocal` values and restores them when async code runs.
With the extension, `@RequestScoped` beans, `@Transactional`, and REST context propagate through Mutiny chains automatically.

```java
@RequestScoped
public class RequestContext {
    private String traceId;
    // getters / setters
}

@GET
public Uni<TraceResponse> getTrace(@HeaderParam("X-Trace-Id") String traceId) {
    requestContext.setTraceId(traceId);
    return Uni.createFrom().item("ok")
        .onItem().delayIt().by(Duration.ofMillis(10))
        .map(ignored -> new TraceResponse(requestContext.getTraceId(), "async"));
}
```

## Important Rules

- **Never block I/O threads** — `await()` and `toIterable()` throw if called on an I/O thread.
- **Subscription is mandatory** — without `.subscribe().with(...)` or framework-managed subscription, nothing executes.
- **Use shortcuts** — `uni.map(...)`, `uni.flatMap(...)`, `uni.chain(...)`, `uni.invoke(...)` for conciseness.
- **Context propagates automatically** — CDI request scope, transactions, and REST context flow through Mutiny chains by default.

## Testing

- `MutinySmokeTest` verifies pure Mutiny API chains.
- `ReactiveEchoControllerTest` verifies RESTEasy Reactive auto-subscription.
- `ContextPropagationControllerTest` verifies `@RequestScoped` state survives `Uni` delays and chains.
