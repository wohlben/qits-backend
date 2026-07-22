# Epic: qits-settings — instance configuration for qits

## Introduction

A generic, **database-backed settings** backbone for a qits instance: a key/value store, a
service + REST boundary, and an SPA **Settings** route — so an operator can change an instance's
behaviour at runtime instead of only at build/deploy time via config properties, and (later)
override a value at multiple levels of a **hierarchy**. The first setting is the **default coding
agent**, which additionally gains a per-launch override on the workspace's Agents/Chat tab.

**Builds on [qits-coding-agents](../qits-coding-agents/epic.md)**: the default-agent setting
supersedes that epic's global `qits.agent.type` property as the source of truth, and the workspace
agent picker feeds an explicit `AgentType` into its launch path per launch (recorded on the command
so transcript import / auth resolve per-harness).

Related epics / cross-cutting concerns:

- **Surfaced by [qits-workspace-detail](../qits-workspace-detail/epic.md)**: the Agents and Chat
  tabs gain the per-launch agent dropdown that is the "final decision" level of the hierarchy.

## Parts (ideas)

- **[db-backed-default-agent-and-picker](feature-ideas/db-backed-default-agent-and-picker.md)** —
  the settings key/value backbone (entity/table/service/REST + an SPA Settings route), the
  **default coding agent** as its first setting (replacing the `qits.agent.type` property),
  per-command harness recording, and the workspace Agents/Chat-tab **agent dropdown**. Resolution is
  a **two-level** hierarchy this feature ships: the qits-wide default → the workspace-tab per-launch
  choice. The setting-key namespacing and the resolver signature are designed so future levels
  (project / repository / persistent-per-workspace) slot in without a rewrite.

## Done when

Rolling: current when its `feature-ideas/` is empty and every instance-settings feature has landed
here.

## Status

| Part | Status |
|---|---|
| [db-backed-default-agent-and-picker](feature-ideas/db-backed-default-agent-and-picker.md) | idea |
