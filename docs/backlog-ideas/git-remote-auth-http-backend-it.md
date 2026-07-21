# Git remote auth: extended IT against a real basic-auth smart-HTTP server

## Introduction

[git-remote-https-auth](../epics/qits-project-repositories/features/2026-07-21_git-remote-https-auth.md)
shipped with unit/domain coverage only (classifier, credential-args seam, session lifecycle against
local bare remotes with rigged hooks). This parks the extended integration test that was
deliberately cut: a real auth wall proving the **credential-store round-trip** end to end, phrased
as an addition to the already-implemented `GitRemoteAuth`/`RemoteLoginSessions` code.

Related / dependent plans:

- `docs/epics/qits-project-repositories/features/2026-07-21_git-remote-https-auth.md` — the landed
  feature this test hardens.
- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md` — the `-Pextended`
  suite conventions (`*IT`, `@Tag("extended")`, self-skip when the backend is absent) this test
  would follow, e.g. `WorkspaceContainerIT`.

## The test

A JUnit `*IT` (`@Tag("extended")`, domain module) that:

1. Starts a local smart-HTTP git server requiring basic auth — `git http-backend` behind a tiny
   HTTP frontend (e.g. `busybox httpd`/`lighttpd` with an auth stanza, or a minimal JDK
   `com.sun.net.httpserver` shim that checks the `Authorization` header and delegates to
   `git http-backend` via CGI env). Self-skips when `git http-backend` is unavailable.
2. Proves the **fail-fast + classify** half: a non-interactive push through
   `RepositoryService.pushRepository` against the auth-walled URL fails immediately
   (`GIT_TERMINAL_PROMPT=0`, no hang) and `GitRemoteAuth.isAuthFailure` matches the output.
3. Proves the **store round-trip**: drive `RemoteLoginSessions.open` against the same repo, type
   the username/password through `RemoteLoginSession.input` at git's real prompts, assert the push
   succeeds, the store file gains a `https://user:pass@host` line, and — the point — a second,
   plain non-interactive `pushRepository`/`pullRepository` now succeeds without any prompt.
4. Optionally proves self-healing: rotate the server's password, assert the next non-interactive
   push fails auth-classified again and the store line was erased (`reject`).

## Trigger

Pick this up on the first real-world auth regression against a hosted remote (GitHub/GitLab
behaving differently than the classifier or store expects), or when starting SSH-remote support
(whose provisioning tests would share the local-git-server harness built here).
