# Agents tab instantly exits: auto-resume of a session id the agent no longer knows

> **RESOLVED 2026-07-17** (fix in tree): the Agents tab no longer auto-`--resume`s. Resolution
> attaches only to an actually running agent process; with history and nothing running it idles
> on an explicit choice — "Start new session" in the embed, or per-row **Resume** in the session
> list (new affordance on `AgentSessionRowsComponent`/`WorkspaceSessionTreeComponent`, offered
> only while nothing runs). The ended state gained a "New session" fallback next to Resume.
> Feature doc updated (`2026-07-10_embedded-workspace-agent-session.md`); specs cover the new
> resolution, the fallback, and the list resume. Move to `resolved/` once verified in prod.

## Introduction

Related/dependent plans:

- `docs/epics/qits-workspace-detail/features/2026-07-10_embedded-workspace-agent-session.md` — the resolution contract this
  changes (step 3: auto-resume → explicit choice).
- `docs/epics/qits-coding-agents/features/2026-07-10_agent-session-lineage.md` — the recorded lineage the resolution reads;
  the lineage stays authoritative for *what* can be resumed, just not *when* it happens.
- `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — re-materialization is one
  way the agent-side session state diverges from qits' recorded lineage.

## Observed (prod, 2026-07-17)

Opening the Agents tab launches and instantly lands in the ended state; the transcript shows

```
No conversation found with session ID: 7737316c-d824-46d2-9c30-eb6f2f5c5686
```

Resume retries the same id and instantly exits again — the tab is effectively dead for the
workspace.

## Cause

Resolution auto-launched `--resume <lastSessionId>` whenever the workspace had session history
and nothing was running. qits' lineage records the id durably, but the agent's own conversation
state (under the shared `/claude-home` volume, keyed by project path) can no longer contain it —
re-materialized containers, pruned/replaced volume state, or sessions minted against the removed
legacy deployment (`2026-07-17_two-stacks-collide-on-qits-net-alias.md`). `claude --resume` with
an unknown id prints the error and exits; the tab auto-ran into it on every activation with no
way to choose a fresh start.

## Fix

Attach only to *running* agent processes; make every launch explicit (fresh via "Start new
session" / ended-state "New session", resume via the session list's per-row Resume or the ended
state's Resume). No backend change — the launch endpoint already accepted an optional
`resumeSessionId`.
