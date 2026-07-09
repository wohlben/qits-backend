# Feature dossier: an iteratively-built change-summary tab on the workspace detail route

## Introduction

The workspace detail route already hosts one tab per runtime concern (Chat, Files, Daemons, Web
view, Telemetry, Agents, and the planned Actions tab). This idea adds a **Feature dossier** tab:
a space that iteratively collects and summarizes information relevant to whatever change is
being planned in that workspace — a living brief the user (or the coding agent) builds up over a
session rather than a one-shot report.

Related/dependent plans:

- **Extends the [workspace detail tab consolidation](../features/2026-07-09_workspace-detail-tab-consolidation.md)**
  and [draggable tabs](../features/2026-07-09_draggable-workspace-detail-tabs.md) — one more
  `<z-tab>` in the existing group; drag-reorder persistence already merges unknown labels
  gracefully.
- Likely draws on the same context machinery as [chat](../features/2026-07-04_workspace-chat-dialog.md)
  and the [coding agent harness](../features/2026-07-01_coding-agent-harness.md), since
  "relevant information" (diffs, related files, prior chat context) overlaps with what the agent
  already has access to in a workspace.
- Synergy with the [dynamic filters](../features/2026-07-03_workspace-filter-ordered-rules-and-ignorelists.md)
  machinery already built for the file browser — but in the other direction: the dossier's
  "relevant to this change" file list could feed the file browser as a *new* dynamic filter
  (e.g. a whitelist rule set derived from the dossier), so the file browser can be narrowed to
  just what the dossier flagged as relevant.

## The idea

A tab where content accumulates as the user plans a change — notes, linked files, relevant
context pulled from the repo or from chat — rather than a static report generated once. Exact
mechanics (what triggers an update, how it's stored, whether the coding agent authors entries)
are unresolved; this is a placeholder for later in-depth design, not a spec.

Example content the dossier might surface, to give shape to "relevant information":

- **Related file lists** — classes/docs judged relevant to the change, e.g. entities and
  services touched by the current diff, their test counterparts, and doc pages that reference
  them. This list is itself a candidate source for a new dynamic filter in the file browser
  (see synergy note above), not just a display in the dossier tab.
- **Awareness highlights** — badges/callouts flagging change categories worth a second look
  before merging, e.g. "entity change" (Panache entity touched → migration may be needed) or
  "DB change" (a Flyway migration is part of the diff). Not validation, just surfacing.

## Trigger

Pick this up when workspace-scoped planning context (notes, related-file tracking, evolving
summaries) becomes a recurring manual workaround worth automating — promote to
`docs/feature-ideas/` for full design at that point.
