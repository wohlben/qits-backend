# Prompt-draft concurrent first-insert races to a 500 (and loses that autosave)

> **Resolved 2026-07-20** (high-effort code review of the step-4 diff). Fixed with option 3 below —
> a DB-native atomic upsert. `WorkspacePromptDraftRepository.upsert(...)` issues a single H2
> `MERGE INTO … KEY (workspace_id_fk) … VALUES (…, current_timestamp)` keyed on the shared PK, and
> `WorkspacePromptDraftService.saveDraft` calls it instead of the read-then-insert (then re-reads to
> return the DB-assigned `updatedAt`, which a later GET returns byte-for-byte so the client's own-echo
> dedup still holds). The MERGE serializes concurrent first-saves under the row lock — last write
> wins, no PK violation. Regression:
> `WorkspacePromptDraftControllerTest.concurrentFirstSavesUpsertWithoutRacingToA500` fires 8
> simultaneous first-saves for a draftless workspace and asserts every one is a clean 200 with one
> surviving row. The richer optimistic-concurrency escalation (option 1: base-`updatedAt` → 409) is
> **not** built — it stays parked under the feature's *Concurrent editing* open question; this fix
> only removes the transient 500, keeping last-write-wins.

## Introduction

Surfaced by the high-effort code review of the `refresh-resilient-prompt-building` step-2 diff
(attachment rows backend). This is **pre-existing step-1 code**, not introduced by step 2, but it
directly concerns the multi-device durability the feature is built around, so it is documented here
for a deliberate follow-up.

Related plans:

- [refresh-resilient-prompt-building](../epics/qits-workspace-detail/feature-ideas/refresh-resilient-prompt-building.md)
  — its **Open questions → Concurrent editing** already parks last-write-wins as acceptable and
  names optimistic concurrency (`PUT` carries the base `updatedAt`, 409 → refetch) as the escalation.
  This issue is the concrete first-insert failure mode of that open question.

## Observed / repro (by inspection)

`WorkspacePromptDraftService.saveDraft` upserts with a find-or-create:

```java
WorkspacePromptDraft draft =
    draftRepository
        .findByWorkspaceId(workspace.id)
        .orElseGet(() -> { WorkspacePromptDraft fresh = new WorkspacePromptDraft();
                           fresh.workspaceId = workspace.id; return fresh; });
draft.content = content;
draft.serializedPrompt = serializedPrompt;
draftRepository.persist(draft);
```

The draft's PK **is** the workspace id (shared PK/FK, 1:1). If two clients (two tabs / two devices —
the exact cross-device flow the feature targets) autosave for a workspace that has **no draft row
yet**, both `findByWorkspaceId` return empty, both build a fresh entity with the same PK, and both
`persist`. The first commit wins; the second hits a primary-key/unique-constraint violation that
surfaces as an unmapped `PersistenceException` → **HTTP 500**, and that autosave is dropped.

The window is narrow (both clients saving the *very first* draft within the same debounce interval,
before any row exists) and it is **self-healing on the next autosave** (the row now exists, so the
loser's next debounced `PUT` takes the update branch and succeeds). But the transient 500 is a real
wrong status, and a single lost keystroke-batch is possible.

The same non-atomic shape exists for attachment inserts only trivially — attachment PKs are random
UUIDs, so there is no cross-client PK collision there; this issue is specific to the draft's shared
PK.

## Suspected cause

Non-atomic read-then-insert on a contended shared primary key, with no DB-level upsert (`MERGE`) and
no mapping from a persistence/constraint exception to a retry or to a 409.

## Suggested fix direction

Decide alongside the feature's parked **Concurrent editing** open question — do not fix in isolation:

1. **Cheapest, matches the doc:** wire optimistic concurrency — `PUT` carries the base `updatedAt`,
   the service compares-and-swaps, mismatch/absent-on-insert → **409 Conflict**, client refetches
   and re-applies (the store already treats a refetch as authoritative when pristine). A first-insert
   race becomes a 409, not a 500, and the client retries cleanly.
2. **Narrowest mechanical fix:** catch the constraint violation on first insert and retry as an
   update (the row now exists), turning the race into a successful idempotent upsert. Keeps
   last-write-wins semantics; no client change.
3. **DB-native:** an H2 `MERGE`-based upsert in the repository so the insert/update decision is
   atomic under the row lock.

Add a regression test that drives two concurrent `saveDraft` calls for a draftless workspace and
asserts both resolve to a non-5xx outcome with the row consistent.
