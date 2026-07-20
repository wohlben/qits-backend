---
name: quarkus-validation
description: >
  Use Bean Validation (Hibernate Validator) in Quarkus REST endpoints.
  Covers standard constraints, the project's @NotBlankIfPresent partial-update
  pattern, error responses, and testing validation failures.
---

# Quarkus Validation Skill

Validation is already enabled via `quarkus-hibernate-validator`.

## Standard Constraints

| Annotation | What it checks |
|-----------|----------------|
| `@NotNull` | value is not null |
| `@NotBlank` | string is not null and not blank |
| `@NotEmpty` | string/collection/map is not null and not empty |
| `@Min(1)` | numeric value >= 1 |
| `@Max(100)` | numeric value <= 100 |
| `@Size(min=1, max=50)` | length/size in range |
| `@Pattern(regexp="...")` | matches regex |
| `@Email` | valid email format |

## Create vs Update

**Create requests** — require all fields:

```java
public static record CreateRequest(@NotBlank String name, @NotNull int count) {}

@POST
public Response create(@Valid CreateRequest request) { ... }
```

**Update requests** — use `@NotBlankIfPresent` to allow null (partial update) but reject blanks:

```java
public static record UpdateRequest(
    @NotBlankIfPresent String name,
    String description
) {}

@PUT
public Response update(@PathParam("id") String id, @Valid UpdateRequest request) { ... }
```

The custom constraint lives in `eu.wohlben.qits.validation.NotBlankIfPresent`.

## Error Response

Quarkus REST automatically returns **400 Bad Request**:

```json
{
    "title": "Constraint Violation",
    "status": 400,
    "violations": [
        { "field": "create.request.name", "message": "must not be blank" }
    ]
}
```

## Testing

```java
@Test
public void createWithBlankNameReturns400() {
    given()
        .contentType(ContentType.JSON)
        .body(new CreateRequest("", 0))
    .when().post("/api/items")
    .then()
        .statusCode(400)
        .body("violations.message", hasItem("must not be blank"));
}

@Test
public void updateWithNullNameIsAllowed() {
    given()
        .contentType(ContentType.JSON)
        .body(new UpdateRequest(null, "desc"))
    .when().put("/api/items/1")
    .then().statusCode(200);
}
```

## References

- [Validation Guide](https://quarkus.io/guides/validation)
