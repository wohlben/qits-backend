# Epics orphan cleanup when a project or repository is deleted

## Introduction

Follow-up to [qits-epics Part 1](../epics/qits-epics/features/2026-07-25_domain-and-persistence.md).
Related: the same "no cross-boundary cascade" property exists in
[qits-artifacts](../epics/qits-artifacts/epic.md) (blobs reference branches by string, never cascade).

## Context

Part 1 deliberately isolated the `epics` module into its **own physical H2 database** (the
artifacts-style split-readiness pattern). Because the epics tables live in a separate DB from
`domain`'s `Project`/`Repository`, `Epic.projectId` and `Task.repositoryId` are plain `String`
columns **with no DB-level foreign key** — so there is **no `ON DELETE CASCADE`** back from the
aggregates. Existence is validated on write (in `service`'s controllers), but nothing removes epics
when their owning project is deleted, or tasks when their bound repository is deleted. Those rows
become **orphans**: still queryable, but pointing at a `projectId`/`repositoryId` that no longer
exists.

This is currently acceptable (matching artifacts, which never cascades either), but should be closed
before the planning domain is relied on as the system of record.

## Change

Add app-level cleanup in the **`service`** module (which depends on both `domain` and `epics`):

- **Option A — deletion hook.** Have `domain`'s `ProjectService.delete` / `RepositoryService.delete`
  fire a CDI event (`ProjectDeleted(projectId)` / `RepositoryDeleted(repositoryId)`); an
  `@Observes` listener in `service` calls new bulk-delete methods on `EpicService` /`TaskService`
  (`deleteByProject(projectId)` / `deleteByRepository(repositoryId)`), which cascade within the epics
  DB and write DELETE audit rows. Deterministic, immediate.
- **Option B — startup/periodic orphan sweep.** A scheduled job in `service` lists distinct
  `projectId`/`repositoryId` values in the epics DB, checks them against `domain`, and deletes the
  dangling subtrees. Simpler, eventually-consistent, no `domain` changes.

Leaning **Option A** (immediate integrity, and `domain` gaining deletion events is broadly useful).

## Trigger

Pick this up when the epics domain is first wired into real project/repository deletion flows in the
UI (Part 2 or later), or when a test/user hits an orphaned epic/task pointing at a deleted aggregate.
