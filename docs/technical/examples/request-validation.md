# Request Validation

## Introduction

- Adds systematic Bean Validation for all create and update API endpoints.
- Uses `quarkus-hibernate-validator` (already on the classpath).
- Related to: mutiny reactive programming (validation works transparently with `Uni`/`Multi` return types).

## Scope

- Ensure every `POST` (create) and `PUT` (update) endpoint accepts `@Valid` request bodies.
- Add `@NotBlank` / `@NotNull` constraints to create request records.
- Introduce a custom `@NotBlankIfPresent` constraint for update request records (partial updates: null means "don't change", but if provided it must not be blank).
- Apply constraints consistently across all domain controllers.
- Add regression tests for validation failures (400) and partial-update acceptance (200).

## Dependency

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-validator</artifactId>
</dependency>
```

## Constraints

### Create requests — all required fields

```java
public static record CreateProjectRequest(
    @NotBlank String id,
    @NotBlank String name,
    String description
) {}
```

### Update requests — validate only what is sent

```java
public static record UpdateProjectRequest(
    @NotBlankIfPresent String name,
    String description
) {}
```

`@NotBlankIfPresent` is a custom constraint that accepts `null` (partial update) but rejects `""` or `"   "`.

## Error Response

Quarkus REST automatically maps `ConstraintViolationException` to **400 Bad Request** with a JSON report:

```json
{
    "title": "Constraint Violation",
    "status": 400,
    "violations": [
        {
            "field": "create.request.name",
            "message": "must not be blank"
        }
    ]
}
```

## Testing

- `ValidationTest` — regression tests covering create-validation, update-validation, and partial-update acceptance across representative controllers.
