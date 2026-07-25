# Integration (`mergeBranch`, used by UI Integrate + MCP `integrateBranch`) silently dropped unpushed source-container commits

- **Date:** 2026-07-25
- **Status:** Resolved 2026-07-25
- **Area:** `domain` — `repository.control.WorkspaceService`; surfaced via `RepositoryController` (REST) and `RepositoryMcpTools` (MCP)

## Introduction / related plans

- Workspace execution & merge model: `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md`
- Sibling method that already pushed first: `WorkspaceService.mergeWorkspace` (`WorkspaceController POST /{workspaceId}/merge`)
- Prompted by a review comparing MCP integration (`mcp__repository__integrateBranch`) against the normal UI integrate, on the assumption MCP enforced fewer checks. **Finding: MCP and the UI share the same service method (`mergeBranch`), so they enforce the *same* checks — the gap was in that shared method, not in MCP.**

## What was actually wrong (and what wasn't)

The original report expected integration to enforce three criteria: (1) up to date with the target, (2) no dirty workspace, (3) no unsynced/unpushed commits. Investigation refined this:

- **(2) dirty working tree — was already enforced** on the `mergeBranch` path (`requireCleanWorkingTree`, 400), but the sibling `mergeWorkspace` lacked it. Now both share the guard.
- **(3) unsynced/unpushed commits — the real bug.** `mergeBranch` merged the source branch's *origin* ref without first pushing the source workspace's container, so any commit made inside the container but not yet pushed was **silently excluded** from the integration, with no error — the exact "silently integrate a stale ref" hazard that `mergeWorkspace` already guarded against with a pre-merge push. `mergeBranch` (hence the UI Integrate button and the MCP `integrateBranch` tool) did not.
- **(1) up to date with the target — NOT a real requirement; enforcing it would have been a regression.** The `testing-repo` fixture's `feature` branch is 1-ahead/1-behind `master`, and multiple existing tests (`RepositoryControllerTest.testIntegrateBranchDefaultsToMainBranch`, `GitIdentityAttributionTest.hostSideMergeCommitsAsTheConfiguredIdentity`, the `WorkspaceControllerTest` fast-forward setup) deliberately integrate that diverged-but-clean branch and expect a **merge commit**, not a refusal. Integrating a diverged, cleanly-mergeable branch (yielding a merge commit, or a reported conflict via `hasConflicts`) is a *supported* flow. Neither the UI nor MCP gated on behind-ness, and adding a `behind==0` gate would break that flow. So this criterion was intentionally left unenforced.

## Fix

Consolidated the pre-integration guard into one shared helper so both entry points (and therefore MCP) behave identically and can't drift again:

- New `WorkspaceService.requireSyncedSourceForIntegration(repoId, source)`: when the source branch is backed by a **live container**, it (a) refuses a dirty working tree (400) and (b) pushes the container's branch so the origin ref the merge reads is complete — a failed push aborts the integration rather than being swallowed. A plain branch or stopped workspace (no live container) is a no-op: nothing uncommitted to lose, origin ref provably complete.
- `mergeBranch` now calls it (previously: clean-check only, no push).
- `mergeWorkspace` now calls it (previously: push only, no clean-check) — replacing its inline push block.
- It deliberately does **not** require up-to-dateness with the target (see criterion 1 above).

Code: `domain/src/main/java/eu/wohlben/qits/domain/repository/control/WorkspaceService.java`.

## Tests

- New `domain` regression test `IntegrateSyncsSourceContainerTest`:
  - `integrationIncludesCommitsThatOnlyLiveInTheSourceContainer` — commits inside a source container without pushing, integrates the branch, asserts the commit's file lands in `master` (fails on the old code, which merged the stale ref).
  - `integrationRefusesADirtySourceWorkingTree` — a dirty source container blocks integration with a `BadRequestException` (400).
- Existing merge/integration suites remain green: `RepositoryControllerTest`, `WorkspaceControllerTest`, `RepositoryMcpToolsTest`, `IncomingMergePullNotificationTest`, `GitIdentityAttributionTest`.

## Incidental fix

While running `RepositoryMcpToolsTest`, `exposesExactlyTheRepositoryContextToolset` was failing **independently of this change**: the `prepareSubmoduleBackend` MCP tool (added in commit `0b900bd0`, `RepositorySubmoduleMcpTools`) was never added to the test's expected tool set, though the test's own comment says submodule tools belong to that surface. Added it to the expected set to bring the suite green.
