# Backlog

Loose TODOs and things to revisit. Not full feature/bug docs — promote to
`docs/feature-ideas/` or `docs/bugs/` when one is picked up.

- Flow-detail UI action picker still fetches `GET /action-configurations` (globals only);
  repository-scoped actions are bindable via the API since the action-scope unification
  (`docs/epics/qits-feature-flows/features/2026-07-09_unified-action-scope.md`) but not pickable in that UI yet.
- Cross-workspace fork of agent sessions: fork a session into a *different* workspace of the
  same repository (new branch, inherited conversation). Mechanically already reachable now that
  `docs/epics/qits-coding-agents/features/2026-07-10_agent-session-lineage.md` has landed (shared claude volume, every
  container cwd is `/workspace`) — iteration one deliberately scopes resume/fork to the session's
  own workspace; wants UX for picking the target workspace and a warning that the transcript's
  file references belong to the source branch.
- `CommandLogService.queue` is an unbounded `LinkedBlockingQueue` — heap grows only if H2
  persistence falls behind a chatty daemon; a cap (drop-oldest + warn) would make it strictly
  safe. Noted while resolving
  `docs/issues/resolved/2026-07-21_workspace-container-unbounded-memory-host-oom.md`.
- Daemon log retention: every output line persists to H2 (`command_log_line`) with no retention,
  and the in-container tmux mirror log (`/tmp/qits-daemons/<id>.log`) truncates only on (re)start
  — both unbounded **disk** growth over a long-lived daemon. Same origin as above.
