# Git remote HTTPS auth: a credential store filled by an interactive sign-in terminal

## Introduction

qits talks to a repository's **upstream** remote (`Repository.url`) in five places — the initial
`git clone --mirror`, the pull walk's `git fetch`, the two sync-status probes (`ls-remote` + the
count fetch), and `git push` — and before this feature **none of them could authenticate**:
`GitExecutor` was a plain `ProcessBuilder` with no credential helper configured and no TTY, so
against an auth-requiring HTTPS remote a push died with `fatal: could not read Username for
'https://…'` (or, worse, a transport that decided to prompt hung `waitFor()` forever). qits
effectively supported public-read remotes only.

The fix follows the pattern the coding agent established
([container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)):
**one interactive terminal session persists credentials that every later non-interactive run
reuses**. For Claude that is `exec claude` writing OAuth onto the shared `/claude-home` volume;
for git it is an interactive `git push` in a **host-side PTY terminal**, configured with
`credential.helper=store` pointed at a persistent file — git prompts for username/password (a
PAT) in the terminal, the push succeeds, and the helper persists the credentials keyed by host,
so every future push/fetch/clone against that host just works. The sign-in *is* the retry.

Related/dependent plans:

- **Builds on**
  [push-as-technical-process](../../qits-technical-processes/features/2026-07-21_push-as-technical-process.md)
  — the streamed push dialog is where an auth-classified failure offers "Sign in & push".
- **Pattern precedent** —
  [container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)
  (the sign-in redirect + shared credential volume) and
  `docs/issues/resolved/2026-07-05_claude-auth-login-terminal-no-input.md` (why "run the real
  command interactively" beats a dedicated login subcommand).
- **Terminal substrate** — the xterm.js `web-terminal.component.ts` (`socketPath`-overridable) and
  the pty4j machinery of
  [command-registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md); the
  daemon terminal's dedicated socket (`DaemonTerminalSocket`) is the socket-shape precedent.
- **Benefits pull/import too** —
  [repository-pull-technical-process](../../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md):
  the fetch verbs share the credential helper, so one sign-in also unlocks private-repo pull,
  sync-status, and submodule import.
- **Parked follow-up** — `docs/backlog-ideas/git-remote-auth-http-backend-it.md` (the extended IT
  proving the store round-trip against a real basic-auth smart-HTTP server).

## As built

### 1. The credential store (non-interactive reads/writes)

- `GitRemoteAuth` (`domain`, `repository.control`) owns the seam: a `git credential-store` file at
  `${user.home}/.qits/data/git-credentials` (config `qits.repositories.credentials-file`, set in
  both the service and cli `application.properties`; tests point it under `target/`). Created
  `0600` with parents on first use; it rides the persistent `~/.qits` volume like the bare origins
  and the H2 file.
- Every **remote-touching** git invocation (clone, fetch, ls-remote, push) is built via
  `GitRemoteAuth.gitWithCredentials(...)`, which splices `-c credential.helper=store --file=<path>`
  before the verb. Call sites: `RepositoryService.cloneOne`, the pull walk's fetch, `pushRepository`,
  and the two `syncStatus` probes. Local verbs (rev-parse, merge, update-ref, …) stay untouched.
  The path is prepared (0600, parents) **once** and memoized — `credentialArgs()` runs on every
  remote verb, so it must not re-hit the filesystem — and its first-create tolerates a concurrent
  `FileAlreadyExistsException` and skips POSIX perms on a non-POSIX filesystem.
- The store helper is **appended, not substituted for**, git's ambient helper list (no
  `credential.helper=` reset). A deployment that already authenticates private remotes through a
  host-configured helper (git-credential-manager, a gcloud/CodeCommit helper, a global store) keeps
  working — its helper answers first, the qits store is the fallback the sign-in fills. (An earlier
  reset cleared the ambient list and broke exactly those deployments: **clone has no sign-in flow**,
  so a cleared list left no auth path at all. `GIT_TERMINAL_PROMPT=0` on the non-interactive spawns
  keeps a prompting ambient helper from hanging.)
- The store is keyed by protocol+host: **one sign-in covers every repository on that host** — the
  same instance-level scope as the shared Claude volume. Git self-heals the file: `approve` on
  success, `reject` (erase) on a 401, so a rotated token cleanly re-triggers the sign-in flow.

### 2. Fail fast, never hang (hardening)

`GitExecutor` sets `GIT_TERMINAL_PROMPT=0` on every spawned git. A transport that decides to
prompt no longer blocks `waitFor()` forever; a missing credential is an immediate, classifiable
exit-128 instead.

### 3. Classifying the auth failure

`GitRemoteAuth.isAuthFailure` matches the known auth signatures **anywhere** in the failure output
(remote-side stderr arrives `remote:`-prefixed) — `could not read Username`, `Authentication
failed for`, `HTTP Basic: Access denied`, `The requested URL returned error: 403`, and GitHub's
private-repo disguise `repository '…' not found`. Every settle point of the streamed pull, sync,
and push (`RepositoryService.settleWithAuthHint`/`failWithAuthHint`) attaches `hint: "remote-auth"`
**plus a `hintTarget`** — the repository id to sign into — to the failed `segment-settled` frame.
For a **submodule child** that failed on its own remote (possibly a different host than the root)
the target is the *child's* id, so the sign-in seeds the credentials for the host that actually
rejected, not the root's. Wire-wise `TechnicalProcessFrame` grew trailing nullable `hint` and
`hintTarget` fields (`HINT_REMOTE_AUTH`); the record is the raw EventSource contract, so the new
nullable fields are a backward-compatible addition, and `TechnicalProcess` stores both on the
segment so a late attacher's replay carries them too (`settleSegment(name, ok, hint, hintTarget)` /
`failProvision(msg, hint, hintTarget)`).

### 4. The sign-in terminal (interactive push)

- When any settled segment carries `hint: remote-auth` — in the push, pull, *or* sync dialog (they
  share the process view) — the dialog renders **"Sign in & push"**; clicking swaps the dialog
  content to `<app-web-terminal [socketPath]="api/terminal/repositories/{hintTarget}/remote-login">`
  (the hint's target repo, defaulting to the root when absent). On the terminal's clean close the
  dialog **swaps back to the process view** with the offer still armed, so a failed sign-in (wrong
  PAT) is retried with one more click rather than a Close→re-Push round-trip.
- **Socket-only spawn** (deviation from the draft's `POST /remote-login`): the dedicated
  `@WebSocket("/api/terminal/repositories/{repoId}/remote-login")`
  (`RemoteLoginTerminalSocket`, the `DaemonTerminalSocket` precedent) spawns the session in
  `onOpen` when none is live and **attaches with scrollback replay** otherwise. A POST would have
  added REST surface, an OpenAPI/client regen, and a POST↔connect race for nothing — and a
  connection-owned PTY would kill git mid-prompt on the web terminal's auto-reconnect (1008 token
  refresh). `open()` returns a per-connection `Handle` that the socket uses for all input/resize/
  detach, so a stale connection's keystrokes can never reach a *newer* session spawned for the same
  repo. `onClose` only detaches; the session lingers (`qits.repositories.remote-login-linger-ms`,
  default 60 s) for reattach before an unattended terminal is killed. **No REST change ⇒ no
  OpenAPI/generated-client change at all.**
- The session (`RemoteLoginSessions`/`RemoteLoginSession`, `domain`) is a **host-side pty4j PTY**
  running exactly the interactive form of the same push: `git -c credential.helper=… push <url>
  refs/heads/<b>:refs/heads/<b>` in the bare origin (`RepositoryService.pushSpec`), with terminal
  prompting *enabled* (the PTY provides the TTY). The spawn env is `System.getenv()` + `TERM`, minus
  `GIT_ASKPASS`/`SSH_ASKPASS`/`GIT_TERMINAL_PROMPT` — an inherited askpass (VS Code's integrated
  terminal, the documented `quarkus:dev` launch, sets `GIT_ASKPASS`) or `…PROMPT=0` would otherwise
  divert or suppress the very prompt the terminal exists to show. Deliberately **not** a `Command`
  row nor a `CommandRegistry` session: both spawn seams there hard-prepend `docker exec` and
  terminate via in-container pid-file group kill, while pty4j's host child is a session leader —
  `destroy()`/`destroyForcibly()` is complete termination. Same replay contract as `CommandSession`
  (bounded ring; the blocking replay write runs **outside** the registry monitor so one slow client
  can't stall every repo's sign-in), plus a banner recommending scoped PATs.
- **Single-flight via a reservation, not a guard process** (deviation from the draft's `push`
  kind): the session holds a `TechnicalProcessRegistry.reserveRepository(repoId, "remote-login")`
  lock — mutually exclusive with pull/sync/push on the same bare origin (each `Conflict`s the
  other), but **not** a streamed `TechnicalProcess`. So it is immune to the frame-idle reaper (a
  terminal idling at git's prompt is never force-finished out from under the live push — the reason
  the guard-process approach was abandoned) and **invisible** to `activeForRepository` (a reload
  opens no empty process dialog). The reservation is released the instant the PTY exits —
  `RemoteLoginSession.finish()` runs the registry cleanup **before** the per-client socket closes,
  so release never waits on a silently-dead connection. No completion verdict is emitted, so a
  failed sign-in never shows as a green "done ok"; the terminal's own exit line and the sync-status
  refetch are the signal. A per-schedule token guards the linger backstop so a reattach racing the
  timer's firing wins.
- Session end: the socket sends an exit note and closes cleanly (1000); `web-terminal`'s new
  `closed` output fires and the dialog refetches sync-status (`invalidateRepository`) — "Up to
  date with remote" is the success signal.

## Security considerations

- Credentials rest **plaintext** in the store file — the same trust level as the Claude OAuth on
  the `qits_shared_dot_claude` volume: instance-level, `0600`, owned by the qits user, never
  leaving the host. The terminal's banner recommends scoped PATs over account passwords.
- Helper-based auth keeps tokens **out of argvs, URLs, and error output** — nothing to redact in
  streamed segments or logs (unlike embedding `user:token@` in `Repository.url`, which would leak
  through every error message; explicitly not the chosen mechanism).
- The remote-login socket sits behind the normal `QitsAuthPolicy` (not in `PublicPaths`) and the
  global `SameOriginUpgradeCheck`; under forwardauth every authenticated user shares the
  instance-level store — same as the shared agent login today.

## Known limits

- GitHub's 404-for-private means the `repository not found` hint can false-positive on a genuine
  typo'd URL — acceptable: the sign-in terminal then shows git's real answer either way.
- A mid-sign-in page reload cannot return to the live terminal: the reservation is invisible to
  active-process discovery (by design — it opens no empty dialog), so the reloaded page shows the
  sync bar with buttons enabled, and a Push click 400s "a remote-login is running" until the
  session's linger window (60 s after the reload dropped its socket) frees the repo — at which point
  Push fails auth again and re-offers "Sign in & push". Self-healing but not seamless; surfacing the
  reservation to the frontend so the reload re-offers the terminal directly would need a small
  `/active-process` shape change (the OpenAPI regen this feature otherwise avoids).
- SSH remotes stay out of scope (key provisioning/known-hosts UX is its own feature); the
  username+token form alternative was considered and kept as a possible later convenience.

## Test coverage

- **`GitRemoteAuthTest`** — flag shape (store helper appended, no reset), `0600` creation,
  classifier positives (all five signatures, `remote:`-prefixed included) and negatives (hook
  declined, non-fast-forward, diverged, unreachable).
- **`GitExecutorTest`** — `GIT_TERMINAL_PROMPT=0` rides every spawn.
- **`TechnicalProcessTest`** — hinted settle broadcasts + replays the hint *and its target*; hinted
  `failProvision`.
- **`RepositoryPushProcessTest`** — a pre-receive hook emitting an auth signature settles the push
  segment with `hint: remote-auth`; an ordinary hook rejection carries no hint.
- **`RemoteLoginSessionTest`** — banner+scrollback replay, PTY stdin round-trip, end-listener on
  natural exit and immediately for a late attach, `terminate()` kills a lingering process.
- **`RemoteLoginSessionsTest`** — a live pull refuses the terminal; the live session holds the
  reservation (concurrent push begin → 400) yet stays invisible to `activeForRepository`, and
  replays to a second client; reservation release on exit; an unknown repo throws without leaking
  the reservation. The push is held live by a pre-receive hook spin-waiting on a flag file — no real
  https remote needed.
- **Vitest** — `technical-process-view` emits `segmentHint` (hint + target) for hinted settles only;
  `repository-sync` targets the hint's repo (a submodule child, not the root) for the terminal
  socket, renders "Sign in & push" on the hint, returns to the process view (retry armed) on the
  terminal's `closed`, and clears a stale dialog ref on an ESC/backdrop dismissal; `web-terminal`
  emits `closed` on the clean close only.
