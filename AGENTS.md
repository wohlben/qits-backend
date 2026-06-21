# Project Conventions

## Feature Planning & Documentation

- **Rough drafts** for feature ideas live in `docs/feature-ideas/*.md`.
- Once a feature is implemented, its plan moves to `docs/features/$date_*.md` (e.g., `docs/features/2026-04-24_auth-system.md`).
- Both types of documents must include an **Introduction** section that clearly lists any related or dependent plans. This makes dependencies explicit and helps track which ideas build on others.

## Bug Tracking & Documentation

- **Active bugs** are documented in `docs/bugs/*.md` while they are being investigated or fixed.
- Once a bug is resolved, its document moves to `docs/bugs/resolved/$date_*.md` (e.g., `docs/bugs/resolved/2026-04-25_no-types-in-openapi-schema.md`).
- Bug documents must include an **Introduction** section listing related or dependent plans, just like feature documents.

## Testing

- **Aim for full test coverage** on all new features and bug fixes.
- Every package with business logic should have corresponding JUnit `*Test.java` classes (e.g. `ProjectServiceTest`, `ProjectControllerTest`).
- Regression tests are required when fixing bugs or when a feature is first implemented.
