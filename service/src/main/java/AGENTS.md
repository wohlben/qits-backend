# Java / Quarkus Backend Conventions

## Base Package

`eu.wohlben.qits`

## Package Structure — Domain-first, ECB sub-packages

Each domain gets its own package directly under the base package. Inside, responsibilities are split into fixed sub-packages:

```
eu.wohlben.qits/
  <domain>/             e.g. issue, user, project
    api/                REST boundary — controllers + nested DTO records
    control/            Services — business logic, orchestration
    entity/             JPA / Panache entities and repositories
    mapper/             MapStruct mappers (omit if no mapping layer needed)
```

Example for a domain `issue`:

```
eu.wohlben.qits.issue/
  api/
    IssueController.java
  control/
    IssueService.java
  entity/
    Issue.java
  mapper/
    IssueMapper.java
```

## Controller & DTO Pattern

Controllers live in `<domain>/api/`. DTOs are **static nested records** inside the controller class — no separate DTO files.

Every operation has a named request record and a `Response` record nested inside it. This applies even to GET endpoints with no input — the empty request record is kept for consistency.

```java
@Path("/issues")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class IssueController {

    @Inject
    IssueService issueService;

    @GET
    public ListIssues.Response list() { ... }

    @POST
    public CreateIssue.Response create(CreateIssue request) { ... }

    @PUT
    @Path("/{id}")
    public UpdateIssue.Response update(@PathParam("id") Long id, UpdateIssue request) { ... }

    // ── DTOs ──────────────────────────────────────────────────────────────

    public static record ListIssuesRequest() {
        public record Response(List<IssueDto> items) {}
    }

    public static record CreateIssueRequest(String title, String description) {
        public record Response(Long id, String title, String description) {}
    }

    public static record UpdateIssueRequest(String title, String description) {
        public record Response(Long id, String title, String description) {}
    }

    // Shared projection used across multiple responses would instead go into a dto/* sub-package as a top level record (not nested)
    public record IssueDto(Long id, String title) {}
}
```

### Rules

- Request record name = operation name (imperative verb + noun): `CreateIssueRequest`, `ListIssuesRequest`, `GetIssueRequest`
- `Response` is always a record nested **inside** the request record
- For GET endpoints with no body input: the request record is empty `record ListIssuesRequest() {}` — still present
- Validation annotations (`@NotBlank`, `@Valid`, etc.) go on the record components
- No standalone DTO classes/files — everything lives inside the controller

## Control (Service) Pattern

Services in `<domain>/control/` are plain CDI beans. They contain business logic and call into `entity/` or other `control/` beans. They do not know about HTTP.

```java
@ApplicationScoped
public class IssueService {

    @Inject
    IssueRepository issueRepository;

    @Transactional
    public Issue create(String title, String description) { ... }
}
```

## Entity Pattern

Entities in `<domain>/entity/` use Panache active-record or repository style consistently per domain.

```java
@Entity
public class Issue extends PanacheEntity {
    public String title;
    public String description;
}
```

## Mapper Pattern

MapStruct mappers in `<domain>/mapper/` map between entities and the DTO records defined in the controller.

```java
@Mapper(componentModel = ManagedBean.CDI)
public interface IssueMapper {
    IssueController.IssueDto toDto(Issue issue);
}
```
