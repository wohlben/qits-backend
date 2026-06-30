# Commands navigation & restore (Phase 2)

## Introduction

This is **Phase 2 of 3** of the persistent command-execution model. It delivers the UX centered on
*what's currently active* and *where it came from*: a global "Commands" left-nav, a list of running
and terminated processes, and click-to-reattach for running ones. This phase is **frontend-only** —
the backend already supports it after Phase 1.

Related / dependent plans:
- **Phase 1 — [2026-06-30_command-registry.md](2026-06-30_command-registry.md)** (required): provides `GET /api/commands`,
  the durable command ids, and the re-attachable `/api/terminal/commands/{commandId}` socket this
  phase consumes.
- **Phase 3 — [command-audit-logs.md](../feature-ideas/command-audit-logs.md)** (follow-on): makes terminated rows
  open into a log view. Until then, clicking a terminated command is a no-op / metadata only.

## Goal

Show running + terminated commands and let the user jump back into a running one "as if they never
left" (the Phase 1 socket replays scrollback on attach).

## Conventions to mirror

- Global left nav: `layout/main-navigation/main-navigation.component.ts` (hand-written `<ul>` of
  `<a routerLink>` with `routerLinkActive`). The nav is global, not per-repository.
- Top-level routes: `app.routes.ts` (lazy `loadChildren` per feature). Add a `commands` child.
- List page reference: `pattern/project/project-list.component.ts` — card grid, `injectQuery`,
  `@if isPending/isError`, `@for ... track`, `<app-empty-state>`. No table component is installed;
  use a card grid with a status `badge`.
- Rich smart-list reference: `pattern/repository/branch-list.component.ts` (multiple queries/mutations,
  `router.navigate` row actions).
- Cross-route state is the TanStack Query cache keyed by entity arrays; invalidation idiom in
  `pattern/repository/invalidate-repository.ts`.

## Frontend

- Add a **Commands** entry to `main-navigation.component.ts` (mirror the Projects `<li>`,
  `routerLink="/commands"`).
- New top-level lazy route in `app.routes.ts` → `commands.routes.ts`: list at `''`, terminal at
  `:commandId` (the Phase 1 command terminal page).
- `commands-list.component.ts` (card grid, mirror `project-list.component.ts`): `injectQuery` keyed
  `['commands']` → `commandController.service.ts`. Each card shows action name, repo/branch/worktree,
  short commit, `launchedAt`, and a status `badge` (running vs terminated). Provide a running/terminated
  filter or two sections.
- Row click: **running** → `router.navigate(['/commands', id])` → reattaches and replays scrollback.
  **Terminated** → no-op / metadata for now (log view arrives in Phase 3).
- Invalidate `['commands']` on launch/terminate.

## Verification

1. With a command running (started from a branch terminal), open the **Commands** nav entry → it
   appears with a "running" badge and the correct origin (repo/branch/worktree/commit/action).
2. Click it → lands in the terminal with replayed scrollback, output continuing live.
3. Terminate it (from the terminal or a list action) → badge flips to "terminated"; the `['commands']`
   query refreshes.
4. Terminated rows are listed but inert (until Phase 3).
