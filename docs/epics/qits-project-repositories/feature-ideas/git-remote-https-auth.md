# Git remote HTTPS auth: a credential store filled by an interactive sign-in terminal

## Introduction

qits talks to a repository's **upstream** remote (`Repository.url`) in four places — the initial
`git clone --mirror`, the pull walk's `git fetch`, the sync-status probes, and `git push` — and
**none of them can authenticate**: `GitExecutor` is a plain `ProcessBuilder` with no env
manipulation, no credential helper is configured anywhere, and git gets no TTY. Against an
auth-requiring HTTPS remote, push exits 128 with `fatal: could not read Username for
'https://…': No such device or address`; private-repo clone/fetch fail the same way. Today qits
effectively supports public-read remotes only, and pushing to any real GitHub/GitLab remote is
impossible. (The gap was already called out in
[configurable-git-identity](../../qits-workspaces/features/2026-07-09_configurable-git-identity.md):
"this idea only sets authorship; it does not provision credentials for pushing to an external
remote".)

The fix follows the pattern the coding agent established
([container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)):
**one interactive terminal session persists credentials that every later non-interactive run
reuses**. For Claude that is `exec claude` writing OAuth onto the shared `/claude-home` volume;
for git it is an interactive `git push` in a **host-side PTY terminal**, configured with
`credential.helper=store` pointed at a persistent file — git prompts for username/password (a
PAT) in the terminal, the push succeeds, and the helper persists the credentials keyed by host,
so every future push/fetch/clone against that host just works. The sign-in *is* the retry.

Related/dependent plans:

- **Depends on**
  [push-as-technical-process](../../qits-technical-processes/feature-ideas/push-as-technical-process.md)
  — the streamed push dialog is where an auth-classified failure offers the "Sign in & push"
  terminal.
- **Pattern precedent** —
  [container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)
  (the sign-in redirect + shared credential volume) and
  `docs/issues/resolved/2026-07-05_claude-auth-login-terminal-no-input.md` (why "run the real
  command interactively" beats a dedicated login subcommand).
- **Terminal substrate** — the xterm.js `web-terminal.component.ts` (already
  `socketPath`-overridable) and the pty4j session pattern of
  [command-registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md); the
  daemon terminal's dedicated socket (`DaemonTerminalSocket`) is the precedent for a
  non-command-registry attach path.
- **Benefits pull/import too** —
  [repository-pull-technical-process](../../qits-technical-processes/features/2026-07-19_repository-pull-technical-process.md):
  the fetch verbs share the credential helper, so one sign-in also unlocks private-repo pull,
  sync-status, and submodule import.

## Design

### 1. The credential store (non-interactive reads/writes)

- A `git credential-store` file at `${user.home}/.qits/data/git-credentials` (config
  `qits.repositories.credentials-file`), created `0600`. It lives under `~/.qits`, so it rides the
  existing persistent volume in both the devcontainer and the prod image — surviving restarts,
  exactly like the bare origins and the H2 file.
- Every **remote-touching** git invocation (clone, fetch, ls-remote, push) adds
  `-c credential.helper=` (reset, so ambient host helpers can't interfere) followed by
  `-c credential.helper=store --file=<path>`. Centralize the flag construction in one small
  control-class seam (e.g. `GitRemoteAuth.credentialArgs()`) that the `RepositoryService` call
  sites share; local verbs (rev-parse, merge, update-ref) stay untouched.
- The store is keyed by protocol+host: **one sign-in covers every repository on that host** — the
  same instance-level scope as the shared Claude volume. Git self-heals the file: `approve` on
  success, `reject` (erase) on a 401, so a rotated token cleanly re-triggers the sign-in flow.

### 2. Fail fast, never hang (hardening)

`GitExecutor` sets `GIT_TERMINAL_PROMPT=0` on every spawned git. Today a transport that decides
to prompt can block `waitFor()` forever (there is no timeout); with the flag, a missing
credential is an immediate, classifiable exit-128 instead.

### 3. Classifying the auth failure

`pushRepository` (and the pull fetch) match the failure output against the known auth signatures
— `could not read Username`, `Authentication failed for`, `HTTP Basic: Access denied`,
`The requested URL returned error: 403`, and GitHub's private-repo disguise
`repository '…' not found` — and settle the segment with a typed hint. Wire-wise:
`TechnicalProcessFrame` grows an optional `hint` field on `segment-settled` frames
(`HINT_REMOTE_AUTH = "remote-auth"`); the record is the raw EventSource contract, so a new
nullable field is a backward-compatible addition.

### 4. The sign-in terminal (interactive push)

- When a failed segment carries `hint: remote-auth`, the process dialog renders **"Sign in &
  push"** (per the original UX sketch: error dialog first, login terminal inside it).
- `POST /api/repositories/{repoId}/remote-login` spawns a **host-side pty4j session** running
  exactly the interactive form of the same push: `git -c credential.helper=… push <url>
  <refspec>` in the bare origin, with terminal prompting *enabled* (the PTY provides the TTY).
  Git prompts Username/Password; on success the branch is pushed **and** the store persists the
  credentials — sign-in and retry are one step. Subsequent pushes are non-interactive.
- Attach path: a dedicated `@WebSocket("/api/terminal/repositories/{repoId}/remote-login")`
  (the `DaemonTerminalSocket` precedent), backed by a small in-memory per-repo session registry
  with scrollback replay — **not** a `Command` row: the command registry's persistence hard-FKs a
  workspace (`Command.workspace` is `optional = false`) and its spawn seam always wraps in
  `docker exec`, while this session is repo-scoped and host-side. (pty4j already runs host-side —
  the registry's PTY is the docker *client*; `FakeContainerRuntime` proves the surrounding
  machinery works against plain host argvs.) The frontend embeds the existing
  `<app-web-terminal [socketPath]="…">` in the same dialog.
- Session end: on process exit the socket closes; the dialog refetches `sync-status` — a clean
  exit shows "Up to date with remote" as the success signal. The session is single-flight per
  repo and killable (host process group, the registry's pid-group pattern minus the container).

## Security considerations

- Credentials rest **plaintext** in the store file — the same trust level as the Claude OAuth on
  the `qits_shared_dot_claude` volume: instance-level, `0600`, owned by the qits user, never
  leaving the host. Recommend scoped PATs over account passwords in the terminal's intro line.
- Helper-based auth keeps tokens **out of argvs, URLs, and error output** — nothing to redact in
  streamed segments or logs (unlike embedding `user:token@` in `Repository.url`, which would leak
  through every error message; explicitly not the chosen mechanism).
- The remote-login endpoint and socket sit behind the normal `QitsAuthPolicy` (not in
  `PublicPaths`); under forwardauth every authenticated user shares the instance-level store —
  same as the shared agent login today.

## Alternatives considered

- **A username+token form** POSTing to `git credential approve` — simpler UI, no PTY seam. Kept
  as a possible later convenience, but the terminal is primary: it follows the established
  sign-in pattern, shows git's real prompts and errors verbatim (2FA hints, expired-token
  messages), validates the credentials by *doing the push*, and needs no bespoke form contract.
- **SSH remotes** — the prod image ships `openssh-client`, but key provisioning/known-hosts UX is
  its own feature; out of scope here (HTTPS is what qits clones today).

## Costs and risks

- First **host-side PTY** session — a new seam beside the container-wrapped registry sessions;
  deliberately minimal (one command shape, repo-scoped, in-memory).
- A login-push and a concurrent pull walk could race git on the same bare origin: register the
  session under the repo's process single-flight (kind `push`) so the existing guard covers it.
- GitHub's 404-for-private means the `repository not found` hint can false-positive on a genuine
  typo'd URL — acceptable: the sign-in terminal then shows git's real answer either way.

## Testing sketch

- **Unit:** the credential-args seam (reset + store helper, file path from config);
  `GIT_TERMINAL_PROMPT=0` present on every `GitExecutor` spawn; the auth-signature classifier
  against captured stderr fixtures (github/gitlab/generic 403/private-404).
- **Domain (`@QuarkusTest`):** a push failure with an auth-shaped message settles the segment
  with `hint: remote-auth` in the frame stream; non-auth failures carry no hint. Remote-login
  session lifecycle against a plain host process (echo-prompt stand-in): spawn, attach/replay,
  exit closes the socket, single-flight per repo.
- **Extended IT (optional):** an auth-requiring smart-HTTP server (`git http-backend` behind
  basic auth) proving store round-trip: interactive push persists, second push non-interactive.
- **Component (Vitest):** a `segment-settled` frame with `hint: remote-auth` renders "Sign in &
  push"; clicking swaps the dialog content to the web terminal with the repo-scoped socket path.
