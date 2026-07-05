# Claude sign-in terminal accepts no input — `claude auth login` uses an unreachable loopback OAuth callback

## Introduction

Related / dependent plans:

- `docs/features/2026-07-04_container-agent-sessions.md` — the shared-credential-volume login model this issue breaks.
- `docs/features/2026-07-04_workspace-containers.md` — the per-worktree container execution model (the login terminal is one such container command).
- `docs/features/2026-07-01_coding-agent-harness.md` — the coding-agent code path that triggers the login redirect.
- `docker/workspace/agent-login.sh` — the host-side one-time login script, broken by the **same** root cause (see below).

This is an execution/auth-topology bug, **not** a PTY-allocation bug. The user-visible symptom ("the terminal won't accept input, so it doesn't seem to be a `-it` PTY") led to the opposite hypothesis; the investigation below shows the PTY is correct and interactive, and the real blocker is the OAuth callback topology.

## Observed behavior

1. In the SPA, "Configure with Claude" on a repository/project detail route detects the agent is not signed in and (correctly) redirects to an interactive `claude auth login` terminal command (kind `TERMINAL`) — see `AgentLaunchService.launchChat` → `launchLogin`.
2. The terminal renders and shows:
   ```
   Opening browser to sign in…
   If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=…&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&…
   ```
3. Typing / pasting into the terminal does nothing — no echo, no reaction. The login never completes.

## Investigation & evidence

Reproduced against the live seeded fixture (`seed-webapp`), Claude Code **v2.1.89** in `qits/workspace:latest`, Docker 29.5.3.

**The PTY is real and interactive** (rules out the user's `-it` hypothesis):

- Reproducing the exact qits argv (`docker exec -it -w /workspace -e HOME=/claude-home <c> bash -lc …`) under a genuine `pty.fork()` host PTY: the container process gets `/dev/pts/1`, `[ -t 0 ]` reports **yes**, and bytes written to the master are received by the container (a `cat` echoed them back). So `docker exec -it` allocates a working TTY and forwards stdin.
- The **live stuck** login process (`ps` in the container) is:
  ```
  PID 79  Ssl+  wchan=do_epoll_wait  fd0=/dev/pts/0
  ```
  `fd0 → /dev/pts/0` and stat **`Ssl+`** (the `+` = foreground process group of its controlling terminal) prove it owns an interactive TTY. Output flows correctly through pty4j → `TerminalSocket` → xterm (the URL renders).

**`claude auth login --claudeai` is not a paste-code terminal flow here:**

- Captured under a real PTY for 18s: exactly **518 bytes** of output (the URL), **zero ANSI escape sequences**, no TUI, no terminal-capability queries (no DSR/DA), no "paste code" prompt. Typed input (`THIS-IS-A-FAKE-CODE\r`) produced **zero** reaction.
- The live process holds a socket in state `0A` (**LISTEN**) on **`[::1]:36809`** — i.e. `claude` started a **loopback HTTP callback server inside the container** and is blocked in its Node event loop (`do_epoll_wait`) waiting for the browser to hit it. It never reads stdin.

**The loopback callback is unreachable from the host browser:**

- The container publishes only `8080/tcp → 127.0.0.1:32781` (the seeded dev-server daemon). The callback port `36809` is container-internal `::1`, **not published**, and the host has nothing listening on it.
- `docker exec` cannot publish ports anyway, and `claude` picks a fresh random ephemeral port each launch, so there is no fixed port to pre-publish.

Net: neither completion path works — there is **no paste step** to type into, and the **browser → container-loopback callback** can never arrive. Keystrokes correctly have nowhere to go.

## Suspected cause (code pointers)

- `domain/.../agent/control/AgentLaunchService.java:178` `renderLogin()` launches `exec claude auth login --claudeai` as an interactive PTY command. This assumes `claude auth login` is a terminal-interactive (URL-print + code-paste) flow. In Claude Code v2.1.89 that assumption is false — it is a browser + **loopback-callback** flow.
- `docker/workspace/agent-login.sh:31,33-34` encodes the same stale assumption ("prints a URL + prompts for the code you paste back") and runs `docker run -it … claude auth login` with **no `-p`** — so its in-container loopback listener is equally unreachable from a host browser. The host-side one-time login is broken for the same reason.
- `docker/workspace/Dockerfile` installs `@anthropic-ai/claude-code` unpinned, so the CLI's auth UX can (and did) change under the app without a code change here.

The root cause is general (browser lives outside the container that owns the loopback listener); it is **not** the WSL2/Docker-Desktop networking quirk noted elsewhere, though that environment makes any "publish and reach it" workaround harder.

## Suggested fix directions (not yet chosen)

1. **Switch to a headless/paste-only auth method** that writes to the shared `/claude-home` volume without a loopback callback:
   - `claude setup-token` (long-lived token via a copy/paste flow) if it is genuinely paste-based in this version — verify it does not also open a loopback listener.
   - Or inject a pre-obtained credential onto the shared volume: `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` env on the container (`DockerExecutor.run`) or a token file placed on `qits_shared_dot_claude`, bypassing interactive login entirely. Fits qits' model (one credential crossing into the sandbox).
2. **Make the loopback callback reachable** for the login only: run the login via `docker run` (not `exec`) with a **fixed** callback port published to `127.0.0.1` and force `claude` onto that port (if the CLI exposes such a flag/env). Fragile — depends on a CLI-controlled port and on the browser resolving `localhost` to the same host that published it.
3. **At minimum, fix the UX + docs now**: the "Claude sign-in" terminal currently implies you type into it. Until auth is reworked, surface the real instruction (open the URL; the terminal is output-only) and update `agent-login.sh`'s comments — its "paste the code back here" guidance is currently wrong.

## Regression test to add when fixed

Whatever mechanism replaces `renderLogin()`, add a test asserting the login path does not depend on a container-internal loopback callback (e.g. assert the rendered login command uses the chosen headless method / injects the credential env), so a future CLI-UX change is caught in CI rather than in the terminal.
