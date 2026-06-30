# Command registry — persistent, re-attachable execution (Phase 1)

## Introduction

This is **Phase 1 of 3** of the persistent command-execution model. It replaces the current
connection-bound process lifecycle with an app-scoped registry that owns processes independent of
any WebSocket, so clients can detach and re-attach freely.

Related / dependent plans:
- **Phase 2 — [command-restore-navigation.md](../feature-ideas/command-restore-navigation.md)** (depends on this): the
  global "Commands" nav, the running/terminated list, and click-to-reattach. Frontend-only; relies on
  this phase's `GET /api/commands` and re-attachable socket.
- **Phase 3 — [command-audit-logs.md](../feature-ideas/command-audit-logs.md)** (depends on this): persists the per-line
  MitM log and adds the terminated-command log view. Builds on this phase's capture tee.
- Supersedes the connection-bound lifecycle in `service/.../repository/api/TerminalSocket.java`.
- Directly improves the headless run from the resolve-conflict feature
  (`docs/features/*resolve*` / `ResolveConflictService`), which today is SIGKILLed if the socket drops.

## Problem

Every interactive process is bound 1:1 to a WebSocket connection. `TerminalSocket` spawns a fresh
pty4j `PtyProcess` in `@OnOpen` and SIGKILLs it in `@OnClose` (`destroyForcibly`). Leaving the
terminal route — or a transient network blip, tab refresh, or redeploy — kills the process. Nothing
is persisted, nothing can be re-attached, and there is no list of what is or was running.

## Goal

An `@ApplicationScoped` **command registry** that owns running processes, decoupled from connections,
with REST to create/terminate/list and a terminal socket re-pointed to attach by **command id**. The
process survives disconnect; reconnect re-attaches and replays scrollback.

### Decisions (locked with the user)
- **Channels:** keep the PTY. Two channels — `STDIN` (MitM'd at the socket) and `OUTPUT` (merged
  stdout+stderr; a PTY cannot separate them). `STDERR` is reserved in the enum for a future pipe mode.
- **Concurrency:** allow multiple concurrent commands per (worktree, action). Commands carry their own
  durable id; the terminal route is keyed by command id, not by (worktree, action).
- **Scope:** unify *all* execution through the registry now — interactive terminal runs, non-interactive
  one-offs (`ActionRunService`), and the headless resolve-conflict launch. This makes Phase 1 the heavy
  phase.
- **No auto-cleanup:** a command ends only by exiting itself or by explicit user termination.
  Disconnecting never kills anything; the prior 10-minute auto-timeout on non-interactive runs is removed.

## Conventions to mirror (from codebase exploration)

- No registry precedent exists. The closest pattern is `TerminalSocket.sessions`
  (`ConcurrentHashMap<connId, TerminalSession>`); lift it into a first-of-its-kind `@ApplicationScoped`
  stateful singleton, rekeyed by durable command id.
- Branches and commits are **not** entities — plain `String`s. The only real FK is to `Worktree`;
  `branch` and `commitHash` are String snapshot columns captured at launch (the commit checked out at
  execution time).
- `Worktree` has a surrogate `Long id` (sequence); FK `Command.worktree` joins it. `repository` is
  reachable via `command.worktree.repository`.
- Entity style: `PanacheEntityBase`, public fields. `AbstractActionDefinition` is the template for
  `Command` (`@GeneratedValue(strategy=UUID)` + `@CreationTimestamp`).
- `ActionResolutionService.resolveForRepository(repoId, actionId)` →
  `ResolvedAction(id, name, executeScript /*already rendered*/, interactive, scope, repositoryId, environment)`.
  Treat `executeScript()` as the final shell line.
- `GitExecutor` has `getCurrentBranch(Path)` but no `getCurrentCommit` — add one (`git rev-parse HEAD`).
- REST is OpenAPI-generated: edit `service/src/main/webui/openapi.yml`, then `pnpm generate:api`
  (never hand-edit `src/app/api/**`).

## Backend

New `command/` domain area (BCE layout):

- `entity/Command.java` — `@Entity @Table(name="command")`, `PanacheEntityBase`. Fields:
  `@Id @GeneratedValue(strategy=UUID) String id`; `@ManyToOne(optional=false)
  @JoinColumn(name="worktree_id_fk") Worktree worktree`; `String branch`;
  `@Column(name="commit_hash") String commitHash`; `String actionId`; `String actionName`;
  `@Column(name="execute_script", length=4000) String executeScript`;
  `@Enumerated(STRING) CommandStatus status`; `Integer exitCode`; `boolean interactive`;
  `@CreationTimestamp Instant launchedAt`; `@Column(name="finished_at") Instant finishedAt`.
- `entity/CommandStatus.java` — enum `RUNNING, EXITED, TERMINATED, INTERRUPTED` (INTERRUPTED = process
  lost to a JVM restart).
- `persistence/CommandRepository.java` — `PanacheRepositoryBase<Command, String>`; finders
  `findByStatus`, `findByWorktree`, `listAllOrderByLaunchedAtDesc`.
- `dto/CommandDto.java` record + `mapper/CommandMapper.java` (`@Mapper(componentModel="jakarta")`;
  flatten `worktree.worktreeId`, `worktree.repository.id`).
- `control/CommandRegistry.java` — `@ApplicationScoped`, `ConcurrentHashMap<commandId, CommandSession>`.
  `CommandSession` owns the `PtyProcess`, the single daemon reader thread, a bounded **raw-output ring
  buffer** (~256 KB) for replay, the set of attached `WebSocketConnection`s (output fan-out), the stdin
  write path, and resize. Reader tee = append-to-ring-buffer + broadcast-to-attached. On process
  EOF/exit: set `EXITED` + `exitCode` + `finishedAt`, drop the live session. `terminate()` =
  `destroyForcibly()` + `TERMINATED`. No timeout, no kill-on-detach. Resize with multiple concurrent
  viewers is last-writer-wins.
- `control/CommandService.java` — `@ApplicationScoped`, `@Transactional`. `launch(repoId, worktreeId,
  actionId)`: validate worktree (`existsByRepositoryAndWorktreeId`), derive path
  `dataDir/repoId/worktrees/worktreeId`, capture `branch` (`getCurrentBranch`) + `commitHash`
  (`getCurrentCommit`), resolve action, persist `Command` (RUNNING), spawn via registry, return
  `CommandDto`. Also `launchAndAwait(...)` (blocks on exit; returns exit code + captured text to
  preserve the old synchronous `RunResult` contract); `terminate(id)`; `list(filters)`; `get(id)`.
  Startup reconciliation (`@Observes StartupEvent`): persisted `RUNNING` not in the registry →
  `INTERRUPTED`.
- `GitExecutor.getCurrentCommit(Path)` → `git rev-parse HEAD` (trimmed).
- `CommandController` (`service`, `command.api`), nested request/response records, in `openapi.yml`:
  - `POST /api/commands` `{repoId, worktreeId, actionId}` → `CommandDto`
  - `POST /api/commands/{commandId}/terminate` → `CommandDto`
  - `GET /api/commands` (optional `?status=` / `?repoId=`)
  - `GET /api/commands/{commandId}`
- Refactor `TerminalSocket` → path `/api/terminal/commands/{commandId}`. `@OnOpen` =
  `registry.attach(commandId, connection)` (replay ring buffer, subscribe); `@OnMessage` =
  `registry.input(commandId, data|resize)`; `@OnClose` = `registry.detach(commandId, connection)` —
  **detach only, never kill**. Unknown/terminated command → notice + close.
- Unify non-interactive: `ActionRunService.run` delegates to `CommandService.launchAndAwait` (keeps
  `RunResult` but leaves a `Command` row behind); `ResolveConflictService` launches a command and
  returns its `commandId`. *Verify exact run-now callers during implementation.*
- Migration `V8__command.sql` — `command` table + FK to `worktree(id)`, mirroring
  `V6__repository_action.sql` DDL style.

## Frontend (minimal — re-point the terminal route only)

- `pnpm generate:api` → `commandController.service.ts`.
- New command-centric terminal route `/commands/:commandId` (refactor `branch-terminal.page.ts` into a
  command terminal page that fetches `GET /api/commands/{id}` for its header: repo / branch / worktree /
  short commit / action / status).
- `web-terminal.component.ts`: connect to `/api/terminal/commands/{commandId}`; `ngOnDestroy` closes the
  socket only (detach, no kill).
- Launch sites (`branch-list.component.ts` "Run" + resolve-conflict mutation): `POST /api/commands`
  (or use the commandId resolve-conflict now returns) → `router.navigate(['/commands', commandId])`.

## Tests

- `CommandServiceTest` (domain, `@QuarkusTest`, temp `data-dir` profile like `ResolveConflictServiceTest`):
  launch a trivial `echo`/`sleep` action in a real cloned-fixture worktree; assert the `Command` row
  (FK, branch, commitHash, status RUNNING→EXITED, exitCode); assert detach does **not** terminate;
  assert `terminate()` flips status to TERMINATED; assert startup reconciliation flips stale
  RUNNING → INTERRUPTED.
- `OpenApiSchemaExportTest` regenerates `docs/openapi.yml`.

## Verification (end-to-end)

1. `./mvnw -pl domain -am test -Dtest=CommandServiceTest` and `./mvnw -pl service test` green.
2. `./mvnw -pl service -am test -Dtest=OpenApiSchemaExportTest` regenerates `docs/openapi.yml` cleanly.
3. `./mvnw -pl service quarkus:dev`, seed, open a branch terminal, start `sleep 300; echo done`.
4. Navigate away and back (or refresh) → the **same** process is still running, scrollback replays,
   output continues. (Previously this killed it.)
5. `GET /api/commands` lists it RUNNING with the right worktree/branch/commit/action.
6. `POST /api/commands/{id}/terminate` → process dies, status flips to TERMINATED.
7. Restart the dev server with a command RUNNING → it returns as INTERRUPTED, not stuck RUNNING.

## Risks / call-outs

- Phase 1 is large because of the unify decision; the non-interactive refactor touches the run-now
  endpoint and resolve-conflict — exact callers to be confirmed while implementing.
- No auto-cleanup means hung commands accumulate until manually terminated (by design).
- stdout/stderr are not separable under a PTY — OUTPUT is merged (by design).
