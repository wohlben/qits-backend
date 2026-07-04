# Project Conventions

## Feature Planning & Documentation

- **Rough drafts** for feature ideas live in `docs/feature-ideas/*.md`.
- Once a feature is implemented, its plan moves to `docs/features/$date_*.md` (e.g., `docs/features/2026-04-24_auth-system.md`).
- **Parked follow-ups** live in `docs/backlog-ideas/*.md`: fully written idea docs for changes we have deliberately decided not to build yet. They are written from the perspective of their parent feature **already being implemented** — as a change to existing code, never as an alternative design — and must name a **Trigger**: the condition under which the idea gets picked up. When one is picked up it is treated like any other feature draft and moves to `docs/features/` once implemented. (Distinct from `docs/backlog.md`, which is only loose one-liner TODOs.)
- All of these documents must include an **Introduction** section that clearly lists any related or dependent plans. This makes dependencies explicit and helps track which ideas build on others.

## Bug Tracking & Documentation

- **Active bugs/issues** are documented in `docs/issues/$date_*.md` while they are being investigated or fixed.
- Once resolved, the document moves to `docs/issues/resolved/$date_*.md` (e.g., `docs/issues/resolved/2026-04-25_no-types-in-openapi-schema.md`).
- Issue documents must include an **Introduction** section listing related or dependent plans, just like feature documents.
- **Document bugs on encounter, proactively.** Whenever a bug, anomaly, or leftover is noticed during *any* task — even one entirely out of scope — write the `docs/issues/` document **immediately, as part of that same task**, so it is captured for in-depth analysis later. Do not merely flag it in a summary or leave it for review: record what was observed (repro steps), the suspected cause (with file/class pointers if already known), and a suggested direction for the fix. The current task's scope does not change — the document is the hand-off, not an obligation to fix.

## Testing

- **Aim for full test coverage** on all new features and bug fixes.
- Every package with business logic should have corresponding JUnit `*Test.java` classes (e.g. `ProjectServiceTest`, `ProjectControllerTest`).
- Regression tests are required when fixing bugs or when a feature is first implemented.
