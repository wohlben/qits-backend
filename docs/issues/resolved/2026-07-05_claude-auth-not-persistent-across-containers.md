# RESOLVED: Claude auth login not persistent across containers — HOME defaults to container-local /workspace

## Introduction

Related / dependent plans:

- `docs/features/2026-07-04_container-agent-sessions.md` — the shared-credential-volume login model this bug undermined.
- `docs/issues/resolved/2026-07-05_claude-auth-login-terminal-no-input.md` — the sibling login fix (wrong command); surfaced while testing this one.
- `docker/workspace/Dockerfile` — sets `ENV HOME=/workspace`, the root of this bug.
- The `WorkspaceContainerFactory` refactor (single container-creation seam) — where the fix lands.

## Symptom

After signing `claude` in inside one worktree container, other containers (other worktrees/repos)
report signed-out, so the coding agent re-prompts for login per container — the shared-volume
one-time-login model appears not to work.

## Root cause

The workspace image sets `ENV HOME=/workspace` (Dockerfile line 56), and `/workspace` is the
**container-local** git clone — not the shared credential volume (`qits_shared_dot_claude` mounted at
`/claude-home`). Claude Code stores its login at `$HOME/.claude/.credentials.json`. So credential
persistence worked **only** when a `claude` invocation explicitly overrode `HOME=/claude-home`.

qits' agent code paths (`AgentLaunchService.renderLogin` / `renderChat` / `renderAutonomous` and
`AgentAuthStatus.isLoggedIn`) all set that overlay, so the UI flow was self-consistent. But **any**
`claude` run that missed it — an ad-hoc `claude` in a bash-action terminal, or any future code path —
wrote its login to the container-local `/workspace/.claude`, invisible to every other container.

Verified on the live fixture:

- `HOME=/claude-home claude auth status` → `loggedIn: true` in **all four** containers (shared volume
  works when HOME points at it).
- Default `HOME=/workspace` → `loggedIn: false` in the containers with no local login, but `true` in
  `qits-wt-greeting-b06e6907`, which had a stray container-local `/workspace/.claude/.credentials.json`
  from a bash-terminal login — the exact "not persistent across containers" artifact.

Confirmed fix mechanics (live):

- Claude honors `CLAUDE_CONFIG_DIR`: `HOME=/workspace CLAUDE_CONFIG_DIR=/claude-home/.claude claude
  auth status` → `loggedIn: true`.
- `docker run -e VAR=…` is inherited by every subsequent `docker exec` (throwaway-container check).

## Fix

Set `CLAUDE_CONFIG_DIR=/claude-home/.claude` as a **container-wide environment variable at creation**,
so every in-container `claude` — agent launch, chat, login, and ad-hoc bash `claude` — reads and
writes its credentials on the shared volume regardless of `HOME`. `HOME` stays `/workspace` so
git/tools remain container-local, matching the "only `~/.claude` crosses into the sandbox" intent.

- `WorkspaceContainer` gains an `env(key, value)` builder seam rendering `-e key=value`.
- `WorkspaceContainerFactory.forWorktree(...)` adds `CLAUDE_CONFIG_DIR=<claude-mount>/.claude`, gated
  on the shared volume being configured (no volume → nothing to point at, so it is omitted).

Because it is inherited by every `docker exec`, cross-container persistence no longer depends on each
launcher remembering the `HOME=/claude-home` overlay (those overlays are now belt-and-suspenders and
can be simplified later once all containers are recycled).

## Transition note

Existing containers created before this change have no `CLAUDE_CONFIG_DIR` and must be recreated to
pick it up (qits re-provisions a container on demand via `WorktreeService.ensureContainer`). The
current shared login at `/claude-home/.claude/.credentials.json` is exactly the path
`CLAUDE_CONFIG_DIR` targets, so recreated containers recognize it with no re-login. The stray
container-local `/workspace/.claude` in `qits-wt-greeting-b06e6907` is harmless and disappears when
that worktree's container is recreated.

## Regression test

`WorkspaceContainerFactoryTest` asserts `forWorktree(...).toRunArgv()` contains
`-e CLAUDE_CONFIG_DIR=/claude-home/.claude` (and omits it when the volume is disabled);
`WorkspaceContainerTest` covers the `-e` rendering seam.
