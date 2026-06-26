# Agent Guidelines

## Goals

- Maintain high-level domain documentation for the QITS application.
- Keep documentation technology-agnostic and focused on user flows and domain concepts.
- Ensure every directory contains a `README.md` that explains the domain concept at that level, not an index of files.
- Keep each `README.md` under 200 lines, targeting ~50 lines. Expand only when the topic demands it.

## Repository Structure

```
docs/
├── README.md
└── userflows/
    ├── README.md
    └── $domain/
        ├── README.md
        ├── ($potentially-more-granular-split/)
        │   ├── README.md
        │   └── ...
        └── $user-story.md
```

## Path Conventions

- `docs/userflows/$domain/` — contains all user flows for a given business domain.
- `docs/userflows/$domain/README.md` — plain overview of the domain (what it is, why it exists). Must not be a file index.
- `docs/userflows/$domain/$user-story.md` — a domain-level outcome (not a single CRUD operation). Each file describes a meaningful activity a user performs to achieve a business goal.
  1. **User Story** — the narrative describing who, what, and why. Focus on the outcome, not the API call. One story may touch many entities.
  2. **Builds On** *(optional, use sparingly)* — ordered, nested list of prerequisite user flows that must be completed *before* this one in a genuine narrative sequence. Use this only when the prerequisite is a distinct user activity that logically precedes this one (e.g., you cannot create a worktree before a repository exists). Do not list every foreign-key dependency or parent entity; mention those in the narrative instead. References use the form `$domain/$user-story-slug` (matching the filename without `.md`).
  3. **Processes** — bullet list of all kebab-case process IDs involved in enabling this story. It is fine for one story to reference many processes.

### Granularity Rules

- **One user story per outcome**, not one per endpoint. If a user conceptualizes a task as a single activity, keep it in one file even if it spans multiple entities or APIs. Split only when the activities are genuinely independent user goals.
- **Do not decompose by entity lifecycle phase.** "Design Feature Flow" covers creating the configuration, its phases, its steps, and assigning actions — because to the user that is one continuous task. The individual entities are implementation detail.
- **Builds On is for narrative sequencing, not data dependencies.** If story B merely needs an entity created in story A, that is a dependency, not a narrative prerequisite. Mention it in the user-story text (e.g., "Given a cloned repository...") rather than in `Builds On`.

### Example

**Too granular (do not do this):**
- `create-feature-flow-configuration.md`
- `create-feature-flow-phase.md`
- `create-feature-flow-phase-step.md`
- `assign-action-to-step.md`

**Correct outcome-level story:**
- `design-feature-flow.md` — "As a lead developer, I want to design a feature flow for my repository so that every new feature follows a standardized lifecycle with clear phases, steps, and quality gates." This single story references `feature-flow-configurations`, `feature-flow-phases`, `feature-flow-phase-steps`, and `feature-flow-phase-actions` under **Processes**.

- Any intermediate directory must also contain a `README.md` with a domain overview.

