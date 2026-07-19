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
