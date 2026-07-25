# Outdated-daemon warning + Recreate workspace

**Status: implemented 2026-07-25** · Part 2 of [qits-workspace-registry](../epic.md)

## Introduction

Part 1 made each running workspace's **daemon build identity** (version + build time) a registry
fact, rendered as a `daemon {version}` badge in the branch tree. That badge was informational only.
This part makes it **actionable**: it derives, purely from the registry, which build is the *latest*
currently connected, warns on any workspace running an older one, and offers a **Recreate workspace**
action that rolls the container onto the current image (which carries the newer daemon).

Related / dependent plans:

- **Part 1 — [workspace-daemon-registry-info](2026-07-25_workspace-daemon-registry-info.md)** — the
  source of the `daemonVersion`/`daemonBuildTime` facts this part orders and compares. This part adds
  the enumeration seam (`WorkspaceDaemonInfo.all()`) and one derived field (`daemonOutdated`).
- **Extends [qits-workspaces](../../qits-workspaces/epic.md)** — the Recreate operation lives on
  `WorkspaceService` beside `ensureContainer`/`stopContainer`, and reuses the lazy-provision path
  (`docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md`).
- **Consumes the clean/dirty registry fact** — the gate that protects Recreate reads the daemon's
  tri-state cleanliness (`WorkspaceGitStatus.isClean`, `Optional<Boolean>`), the same fact the UI
  uses to enable/disable the button.

## What "latest" means (registry-only)

"Latest" is derived **from the registry alone** — no build constant, nothing persisted, consistent
with the epic's scope rule. It is the newest daemon build among **all daemons currently connected**
anywhere (across every repo), ordered by **`daemonBuildTime`** (the `-SNAPSHOT` tiebreaker Part 1
introduced), with version as a last-resort tiebreaker. A workspace is **outdated** when its own build
is *strictly older* than that maximum.

Consequences of the registry-only definition (intentional):

- A daemon that reports **no build time** (an older image) can't be ordered, so it never becomes "the
  latest" and is itself never flagged.
- With only one daemon connected, it *is* the latest — nothing is flagged.
- If no workspace is yet on the new build, nothing is flagged (there is no out-of-band "newest build
  on disk" signal — the registry only knows what's running).

`daemonOutdated` is a new nullable `WorkspaceDto` field: `true` = a newer build is connected
elsewhere; `null` = not comparable / up-to-date (no warning). Like every registry fact it is
RUNNING-only and computed live, never stored.

## Recreate workspace

A new `POST /api/repositories/{repoId}/workspaces/{workspaceId}/recreate-container` (→
`WorkspaceService.beginRecreateContainer`) tears the container down and re-provisions a fresh one
from the durable branch. Because a fresh `docker run` resolves `qits.workspace.image` anew, the new
container comes up on the current daemon build; the registry then reflects the new
version/build-time, clearing the warning.

**Clean-only, verified server-side.** Recreate is destructive (an unpushed/uncommitted change would
be lost), so it is gated on the daemon-reported tri-state and admits **only an explicit clean**:

| reported state | `isClean()`         | recreate |
| -------------- | ------------------- | -------- |
| clean          | `Optional.of(true)` | allowed  |
| dirty          | `Optional.of(false)`| 400      |
| unknown        | `Optional.empty()`  | 400      |

Rejecting **unknown** in its own right (not folding it into "dirty") is deliberate: a workspace whose
daemon isn't reporting has an unknowable tree, which is not a safe basis to destroy a container. The
gate runs synchronously so a bad request 400s immediately; the teardown then streams like
`ensure-container` over a technical process: best-effort `git push` (preserve committed work) → settle
daemons gracefully → `docker rm` → re-provision. The UI enables the button only when `clean === true`,
but the backend re-verifies regardless (a direct API call can't bypass it).

## Surface

Branch row only (`ui/components/repository/branch-row.component.ts`), where the version badge lives:

- The `daemon {version}` badge turns into a warning (destructive style + `lucideTriangleAlert`, a
  "newer build available" tooltip) when `daemonOutdated`.
- A **Recreate workspace** button appears in the RUNNING action group only when `daemonOutdated`,
  enabled only when `clean === true` (disabled with an explanatory tooltip otherwise). It is wired
  through `app-branch-tree` to `branch-list.component.ts`'s `recreateContainerMutation`, which streams
  provisioning progress in the same dialog as ensure/start.

## Implementation

- `domain` — `WorkspaceDaemonInfo.all()` (enumeration seam) + `WorkspaceDaemonRegistry.all()` (open
  connections only); `WorkspaceDto.daemonOutdated` (+ mapper ignore); `WorkspaceService.listWorkspaces`
  computes the global latest once and flags each RUNNING workspace; `WorkspaceService.beginRecreateContainer`
  + `requireCleanForRecreate`.
- `service` — `WorkspaceController.recreateContainer` (`POST .../recreate-container`).
- `webui` — regenerated API client; branch-row warning + button + `recreateContainer` output;
  branch-tree forwarding; branch-list mutation/handler.

## Tests

- `WorkspaceRecreateContainerServiceTest` — clean → rm+fresh clone (untracked marker dropped);
  committed-but-unpushed work preserved via pre-push; dirty → 400 untouched; unknown → 400 untouched;
  unknown workspace → 404.
- `WorkspaceDaemonOutdatedTest` (+ `FakeWorkspaceDaemonInfo`) — older flagged, newest/single/no-build-time
  not flagged, STOPPED carries no badge.
- `WorkspaceControllerTest` — `recreate-container` 400 on unknown-cleanliness, 404 on unknown workspace.
- `branch-row.component.spec.ts` — warning + usable Recreate when clean; disabled when dirty/unknown;
  absent when up to date.
