# RESOLVED: Claude sign-in terminal accepts no input — login guard ran the wrong `claude` command

## Introduction

Related / dependent plans:

- `docs/features/2026-07-04_container-agent-sessions.md` — the shared-credential-volume login model.
- `docs/features/2026-07-04_workspace-containers.md` — the per-worktree container execution model (the login terminal is one such container command).
- `docs/features/2026-07-01_coding-agent-harness.md` — the coding-agent code path that triggers the login redirect.
- `docker/workspace/agent-login.sh` — the host-side one-time login script, which had the same wrong command.

## Symptom

"Configure with Claude" on a repository/project detail route detects the agent is not signed in and
redirects to an interactive "Claude sign-in" terminal (`AgentLaunchService.launchChat` → `launchLogin`).
The terminal renders `Opening browser to sign in…` + an authorize URL, then **accepts no keyboard
input** — typing/pasting does nothing and the login never completes.

## Root cause

The login guard was launching the **wrong command**: the `claude auth login --claudeai` *subcommand*
instead of the interactive `claude` REPL.

In Claude Code v2.1.89, run headless in the container, `claude auth login --claudeai`:

- prints the authorize URL,
- opens a **loopback HTTP callback listener** inside the container (observed: a `LISTEN` socket on
  `[::1]:<random-port>`, e.g. `36809`) and blocks its Node event loop (`do_epoll_wait`) waiting for
  the browser to hit it,
- renders **no paste-the-code prompt** and **reads no stdin** (captured 18s of output = only the URL,
  zero escape sequences, zero reaction to typed input).

So the terminal correctly has nowhere to send keystrokes. It is **not** a PTY problem — the command is
a genuine interactive `-it` PTY (verified: the stuck process had `fd0 → /dev/pts/0` and stat `Ssl+`,
the foreground process group of its controlling terminal; and `docker exec -it` forwards stdin, proven
with a `cat` echo test). The callback port is container-internal loopback, unpublished, and a fresh
random port each launch, so the browser-callback path can't complete either.

The **`claude` REPL**, by contrast, drives an Ink TUI whose first-run onboarding (theme → login method
→ OAuth) renders a paste-the-code login that **does** read stdin. Verified over the exact same
`docker exec -it` PTY: it emits a full TUI and reacts to keystrokes (Enter and `1` both advanced the
onboarding through theme selection into "Select login method"). This is the path that works when you
run `claude` manually from a bash-action terminal.

## Fix

- `domain/.../agent/control/AgentLaunchService.java` `renderLogin()` now returns `exec claude` (was
  `exec claude auth login --claudeai`), keeping the `HOME=/claude-home` shared-volume overlay. The
  operator completes sign-in in the REPL onboarding; credentials land on `qits_shared_dot_claude` and
  the next chat launch sees the login and proceeds.
- `docker/workspace/agent-login.sh` now runs `claude` (was `claude auth login "$@"`), with updated
  guidance (pick the login method in the onboarding menu, paste the code, exit the REPL).
- Comments in `AgentLaunchService`/`AgentAuthStatus` updated to describe the REPL login.

## Regression test

`AgentLaunchServiceTest.loginTerminalRunsTheInteractiveClaudeRepl` asserts `renderLogin()` renders
`exec claude` (interactive, `HOME=/claude-home`) — so a future revert to the non-interactive `auth
login` subcommand fails in CI rather than in the terminal.

## Notes for the future

- The workspace image installs `@anthropic-ai/claude-code` unpinned (`docker/workspace/Dockerfile`),
  so the CLI's auth UX can change under the app. If the REPL onboarding stops offering a paste login,
  revisit this (a pinned CLI version or a headless token method would harden it).
