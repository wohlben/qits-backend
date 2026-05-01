---
name: quarkus-mutiny
description: >
  Use Quarkus Mutiny for reactive programming with Uni and Multi.
  Covers event-driven chains, REST endpoint integration, failure handling,
  shortcuts, and testing patterns in the Quarkus ecosystem.
---

# Quarkus Mutiny Skill

## Overview

Mutiny is the primary reactive programming API in Quarkus.
It is event-driven and lazy: you receive events and react to them.

- **Uni** — emits a single event (item or failure). Represents async actions with 0 or 1 result.
- **Multi** — emits multiple events (n items, 1 failure, or 1 completion). Represents streams.

Mutiny is already on the classpath via `quarkus-rest-jackson` (RESTEasy Reactive).
Explicit dependency: `io.quarkus:quarkus-mutiny`.

## Core Imports

```java
import io.smallrye.mutiny.Uni;
import io.smallrye.mutiny.Multi;
```

## RESTEasy Reactive Integration

Quarkus REST handles subscription automatically when resource methods return `Uni<T>` or `Multi<T>`:

```java
@GET
@Path("/{id}")
public Uni<MyDto> get(@PathParam("id") String id) {
    return service.findById(id)
        .onItem().transform(mapper::toDto);
}

@GET
public Multi<MyDto> stream() {
    return service.findAll()
        .onItem().transform(mapper::toDto);
}
```

## Event-Driven Chains

Pattern: `onEvent().action()` — "on item X do action".

```java
Uni<String> uni = Uni.createFrom().item("hello");

uni
    .onItem().transform(String::toUpperCase)           // sync transform
    .onItem().transformToUni(this::asyncCall)           // async chain
    .onFailure().recoverWithItem("fallback")            // failure recovery
    .onFailure().retry().atMost(3)                      // retry
    .onItem().invoke(v -> log.info("Result: {}", v));   // side effect
```

## Multi Patterns

```java
Multi.createFrom().items("a", "b", "c")
    .onItem().transform(String::toUpperCase)
    .select().first(2)                                  // take first 2
    .collect().asList()                                 // collect to Uni<List>
    .onItem().invoke(list -> log.info("{}", list));
```

## Shortcuts (Concise API)

| Shortcut | Equivalent |
|----------|-----------|
| `uni.map(x -> y)` | `uni.onItem().transform(x -> y)` |
| `uni.flatMap(x -> uni2)` | `uni.onItem().transformToUni(x -> uni2)` |
| `uni.chain(x -> uni2)` | `uni.onItem().transformToUni(x -> uni2)` |
| `uni.invoke(x -> ...)` | `uni.onItem().invoke(x -> ...)` |
| `uni.call(x -> uni2)` | `uni.onItem().call(x -> uni2)` |
| `uni.replaceWith(x)` | `uni.onItem().transform(ignored -> x)` |
| `uni.replaceWith(uni2)` | `uni.onItem().transformToUni(ignored -> uni2)` |
| `uni.eventually(() -> ...)` | `uni.onItemOrFailure().invoke((i, f) -> ...)` |

## Failure Handling

```java
uni
    .onFailure(IllegalArgumentException.class)
    .recoverWithItem("bad input")
    .onFailure()
    .retry()
    .withBackOff(Duration.ofMillis(100), Duration.ofSeconds(1))
    .atMost(5);
```

## Sequential Composition

Chain dependent async operations:

```java
Uni<String> result = fetchId()
    .chain(id -> fetchDetails(id))
    .map(details -> details.name);
```

## Concurrency Helpers

```java
// Run multiple Unis in parallel, collect all results
Uni<List<String>> combined = Uni.combine().all()
    .unis(uniA, uniB, uniC)
    .asTuple()
    .map(tuple -> List.of(tuple.getItem1(), tuple.getItem2(), tuple.getItem3()));

// Combine two Unis
Uni<String> merged = uni1
    .chain(u1 -> uni2.map(u2 -> u1 + u2));
```

## Context Propagation

When using Mutiny in Quarkus, CDI request scope, transactions, and REST context propagate through async chains automatically. No manual work is needed.

```java
@RequestScoped
public class RequestContext { private String traceId; }

@GET
public Uni<String> trace(@HeaderParam("X-Trace-Id") String traceId) {
    requestContext.setTraceId(traceId);
    return Uni.createFrom().item("ok")
        .onItem().delayIt().by(Duration.ofMillis(10))
        .map(ignored -> requestContext.getTraceId()); // still "trace-123"
}
```

This works because `quarkus-smallrye-context-propagation` is pulled in transitively. Only reach for manual `ThreadContext` or `@CurrentThreadContext` if you need to **override** the default behaviour.

## Critical Rules

1. **Never block I/O threads** — `uni.await()` and `multi.toIterable()` throw `IllegalStateException` on I/O threads.
2. **Always subscribe** — lazy by default. Without subscription nothing happens. Quarkus REST subscribes for you; in tests use `.await().atMost(...)`.
3. **Context propagates automatically** — CDI request scope, transactions, and REST context flow through Mutiny chains by default.

## Testing

```java
@Test
public void uniChain() {
    String result = Uni.createFrom().item("hello")
        .map(String::toUpperCase)
        .await().atMost(Duration.ofSeconds(5));
    assertEquals("HELLO", result);
}

@Test
public void multiCollect() {
    List<String> result = Multi.createFrom().items("a", "b")
        .map(String::toUpperCase)
        .collect().asList()
        .await().atMost(Duration.ofSeconds(5));
    assertEquals(List.of("A", "B"), result);
}
```

For REST endpoints returning Uni/Multi, use normal REST-assured tests — RESTEasy Reactive handles the async response transparently.

## References

- [Mutiny Primer](https://quarkus.io/guides/mutiny-primer)
- [Mutiny Reference](https://smallrye.io/smallrye-mutiny/latest/)
- [Handling Failure](https://smallrye.io/smallrye-mutiny/latest/guides/handle-failure/)
- [Retry](https://smallrye.io/smallrye-mutiny/latest/guides/retry/)
