# Workspace containers: sandboxed per-workspace execution (Phase 1 — container, clone, exec)

## Introduction

Everything qits executes — action scripts, dependency installs, dev servers, daemons, the coding
agent and every command it decides to run — used to execute directly on the host as the desktop
user, with the entire home directory (`~/.ssh`, cloud creds, `~/.npmrc` tokens, browser profiles)
reachable by one malicious transitive dependency. This feature makes a **per-workspace Docker
container** the execution environment for all of it: the container sees only a clone of the
repository (pulled from qits' own in-process git server) and nothing else; the host keeps the
credentials, the bare origins, and every trusted git operation. **Containers are a prerequisite
for execution, not a mode — there is no host-execution fallback.**

This is **Phase 1 of 3** (container lifecycle, in-process git hosting + clone, routing command
execution through `docker exec`). Related/dependent plans:

- **Phase 2 — [container-file-access](2026-07-04_container-file-access.md)** (depends on
  this, now implemented): the workspace file browser reads files via `docker exec` instead of host
  paths. Phase 1 leaves the file browser reading host paths; in tests the container is a host-clone at
  the old workspace path so the browser keeps working unchanged.
- **Phase 3 — [container-agent-sessions](../../qits-coding-agents/features/2026-07-04_container-agent-sessions.md)** (depends
  on this, now implemented): the coding agent works inside the container; credential hand-off via a
  shared `~/.claude` volume.
- Moves [daemons](../../qits-workspace-daemons/features/2026-07-04_daemons.md) into the container along with all other registry
  execution — dissolving the port-collision limitation: every workspace's daemon binds its
  canonical port inside its own container network namespace.
- The [daemon web-view picker](../../qits-workspace-detail/features/2026-07-05_daemon-webview-picker.md) proxy resolves targets
  through registry runtime state. As built, the container publishes each web-viewable daemon port to
  an ephemeral localhost port (`docker run -p 127.0.0.1:0:<port>`) and the proxy targets that — the
  bridge-address approach was dropped because container bridge IPs aren't host-reachable under this
  project's Docker Desktop/WSL2 setup.
- Rebuilds the launch/terminate path of the
  [command registry](../../qits-workspace-commands/features/2026-06-30_command-registry.md); everything above the process spawn — ring
  buffer, re-attach, terminal sockets, audit log — is untouched.
- Reworks the on-disk half of the workspace lifecycle from
  [workspace-history](2026-06-30_workspace-history.md): the host checkout under `workspaces/<id>` is
  replaced by the container's clone. The durable-record model is unchanged.
- [Repository discovery](../../qits-project-repositories/features/2026-05-01_repository-discovery.md)'s workspace reconciliation moves from
  on-disk metadata files to container labels.

## The decision (recap)

Full filesystem + network isolation, security first. Cheaper port-only fixes (templating,
loopback aliasing, bare netns) were rejected — they solve ports and nothing else, and the
credential-exposure problem justifies filesystem isolation on its own. Recorded limits: containers
share the host kernel (a strong barrier, not a VM); **egress is open** (a compromised dep can't
read host secrets but can exfiltrate what it finds inside the container); the docker socket is
**never** mounted; inter-container traffic on the default bridge is accepted for iteration one.

## What was built

### In-process git host (`service` module)

- `quarkus-undertow` (the codebase's first servlet) + `org.eclipse.jgit:org.eclipse.jgit.http.server`
  (pinned `7.3.0…`, jakarta.servlet namespace) added to `service/pom.xml`.
- `githost/QitsGitServlet` (`@WebServlet("/git/*")` extending JGit's `GitServlet`) with
  `githost/QitsRepositoryResolver` mapping a validated `{repoId}` slug to
  `Path.of(dataDir, repoId, "origin")`. Anonymous upload-pack **and** receive-pack are enabled
  explicitly (the default receive-pack factory refuses anonymous). No auth — repo ids are
  capability UUIDs.
- `/git` added to `quarkus.quinoa.ignored-path-prefixes`. JGit speaks the wire protocol only; the
  git CLI (`GitExecutor`) remains the sole mutator of repositories.

### `DockerExecutor` / `ContainerRuntime` (`domain` module)

- `repository.control.ContainerRuntime` interface + `DockerExecutor` impl (shells the `docker`
  CLI via `ProcessBuilder`, no docker-java dep; runtime binary configurable). Methods:
  `run` (`docker run -d --init --user <hostUid> --label qits.{repository,workspace,branch,parent}
  --add-host=host.docker.internal:host-gateway <image> sleep infinity`), `exec`, `execArgv` (the
  `docker exec` prefix the registry prepends), `exists`, `rm`, `restart`,
  `listWorkspaceContainers` (reads the labels back).
- Committed `docker/workspace/Dockerfile` (git + node/pnpm + JDK + python + pinned fonts &
  Playwright Chromium — the screenshot-baseline renderer, see
  `2026-07-13_screenshot-baseline-renderer-baked-into-image.md`; `/workspace` made
  world-writable and `HOME`, since the container runs as an arbitrary host uid). Build locally:
  `docker build -t qits/workspace docker/workspace`.
- Config `qits.workspace.{image,container-runtime,git-host,qits-port,term-grace-ms}` in `service`
  and `cli` properties.

### Workspace model → branch column + container lifecycle (`domain`)

- **`Workspace.branch` is now a stored column** (`V20__worktree_branch.sql`) — there is no host
  checkout to derive it from. `currentBranchOrNull`/`findWorkspaceByBranch` read the column;
  `listWorkspaces` uses `wt.branch`.
- **`createWorkspace`/`createMainWorkspace`**: create the branch ref host-side in the bare origin
  (`git branch <new> <parent>`), `docker run` the container, then `git clone --branch <new>
  http://<git-host>:<port>/git/<repoId> /workspace` (the commit identity arrives as `GIT_*`
  container env from the configured `qits.git.*` identity — see
  [configurable-git-identity](2026-07-09_configurable-git-identity.md); with rollback of the
  branch + container on failure).
- **`doDiscard`**: `docker rm -f` the container (its clone dies with it), delete the branch ref in
  origin, soft-delete the row. No host checkout to remove.
- **Workspace-local git verbs are container execs**: `isWorkspaceClean` (`git status --porcelain`);
  `fastForwardWorkspace`/`updateWorkspaceFromParent` fetch origin, **first fast-forward the
  container's own branch to origin's ref** (it may have advanced out-of-band via a host-side
  integration), then ff/merge the parent and push.
- **New safety invariant "fully pushed"**: `canCleanupBranch` additionally requires the
  container's HEAD to equal the origin's branch ref (origin-side ahead/behind can't see
  container-local commits).
- **Host-side unchanged**: `listWorkspaces` ahead/behind, the `merge-tree` probe, and
  `mergeBranch`/`mergeIntoTarget` — which now **always** use a throwaway host workspace in the bare
  origin, since no branch has a host checkout (`findWorkspacePathForBranch`/`workspacePathForBranch`
  return empty). `mergeWorkspace` pushes the source container's branch before integrating so the
  origin refs reflect unpushed work.

### Command execution → the `docker exec` prefix (`domain.command`)

- The two spawn seams in `CommandRegistry` (PTY `startSession`, pipe `spawnChat`) now build a
  `docker exec` command via `ContainerRuntime.execArgv`. The host-side `docker exec` client is the
  process pty4j/ProcessBuilder owns; it inherits the host env (so `docker` is on PATH) while only
  the resolved overlay reaches the container as `-e` flags. `CommandService.prepare` no longer
  inherits `System.getenv()` into the container, reads the branch from the column (in its own
  `QuarkusTransaction` so daemon relaunches on the scheduler thread work), and the commit SHA from
  the container's HEAD.
- **Wrapper + termination**: the launched script runs as `bash -lc 'echo $$ > /tmp/qits-cmd-<id>.pid;
  <script>'` (the TTY path relies on `docker exec -it` making the shell a session leader; the
  no-TTY chat path prepends `setsid`). It is **not** `exec`'d — a compound script isn't a simple
  command `exec` can take, and `$$` is already the process-group leader. `CommandSession`/
  `ChatSession` terminate by reading the pid file and `docker exec … kill -- -<pgid>`, escalating
  SIGTERM → SIGKILL (grace `qits.workspace.term-grace-ms`) → `docker restart` as the last resort —
  because killing the host-side exec client alone orphans the in-container process.

### Startup reconciliation

- Command registry reconciliation (`RUNNING → INTERRUPTED`) is unchanged — the exec clients die
  with the JVM; containers survive.
- `RepositoryDiscoveryService.discover` reconciles ACTIVE workspace rows against
  `listWorkspaceContainers` (labels) instead of the metadata sidecar files: a container with no
  active row rebuilds the row from its labels; an active row with no container is soft-deleted
  ABANDONED.

## Deviations from the idea doc

- The exec wrapper does **not** `exec` the script (compound daemon scripts like `while …; do …;
  done` aren't a simple command), and the TTY path drops `setsid` (`docker exec -it` already makes
  the shell a session leader; `setsid -c` fails EPERM re-stealing the controlling terminal).
- `fastForwardWorkspace`/`updateWorkspaceFromParent` gained a "sync the container's branch to origin
  first" step so a branch advanced origin-side (host integration) is reflected before the ff/merge.
- The branch lookup in `CommandService.prepare` runs in its own transaction (daemon relaunch is on
  a non-request scheduler thread).

## Explicitly deferred (unchanged)

File browsing into the container (Phase 2); agent sessions + credential hand-off (Phase 3);
per-repo images / devcontainer.json; egress allowlisting; remote execution nodes;
idle-stop/restart policies; migration of pre-existing host workspaces (resolve or reseed).
(Resource limits landed 2026-07-21: `qits.workspace.memory-limit` — default `4g`, rendered as
`--memory` + `--memory-swap` — plus opt-in `pids-limit`/`cpus`, all set by
`WorkspaceContainerFactory`; see
`docs/issues/resolved/2026-07-21_workspace-container-unbounded-memory-host-oom.md`.)

## Open questions carried forward

Default image ownership/versioning; container user (docker `--user $(id -u)` today vs rootless
podman — `DockerExecutor` stays runtime-agnostic); `/workspace` volume (anonymous today); per-repo
networks vs the shared bridge; git-server exposure once qits binds beyond localhost.

## Testing

- **Git hosting** — `service` `GitHostTest` (`@QuarkusTest`, no docker): real `git clone` + `push`
  over `/git/<repoId>` moves the ref in the served bare origin; unknown id → 404; traversal-shaped
  id rejected; info/refs advertises upload-pack.
- **`ContainerRuntime` faked** — `FakeContainerRuntime` (a Quarkus `@Mock` in each module's test
  sources) emulates a container as a host clone at the old workspace path, running commands via
  `env -C` and rewriting the clone URL to the on-disk origin and `/workspace` to the workspace dir.
  Because it runs real host processes, the `setsid`/process-group termination works end-to-end.
  The whole existing suite (command lifecycle, daemon supervisor, workspace merge/ff/cleanup,
  discovery, resolve-conflict, seed) passes against it — the tests that create divergence now
  push (origin-side probes only see pushed commits).
- **Real-docker IT** — `service` `WorkspaceContainerIT`, part of the **extended** suite
  (`@Tag("extended")`, run with `./mvnw verify -Pextended`; skipped by default builds; self-skips
  when docker or the image is absent; a plain JUnit test using the real `DockerExecutor`, not
  `@QuarkusTest`, so the `@Mock` doesn't shadow it). Two tests: (1) run + labels round-trip + exec +
  a writable `/workspace` + git operating in the root-owned `/workspace` (safe.directory) + the
  `setsid`/pid-file/`kill -- -pgid` process-group termination + rm; (2) the **interactive PTY
  path** — `pty4j` driving a `docker exec -it` client (the exact registry spawn shape): the inner
  TTY is allocated (`test -t 1`), output streams back through the PTY, `setWinSize` resize
  propagates, and the inner exit code passes through.
- **Live registry PTY run against real docker** (packaged app, real `DockerExecutor` + JGit
  server): a daemon (a PTY registry command) started in a real workspace container reached **READY**
  via its ready-pattern — i.e. its `tick` stdout streamed back through `pty4j ← docker exec -it`
  and was captured as `OUTPUT` log lines; the process (its `bash`/`sleep` group) was confirmed
  running inside the container; graceful **stop** (`registry.signal` SIGTERM → terminate) and a
  direct **`POST /commands/{id}/terminate`** each killed the in-container process group (verified
  with `kill -0 -<pgid>`), and the command/daemon settled STOPPED/TERMINATED. This closes the
  interactive-terminal and launch-through-the-registry-then-terminate paths end-to-end.
- **Ran end-to-end against real docker** (packaged app + real `DockerExecutor` + real JGit server):
  create-repo → main-workspace container clones `/workspace` from `/git/<repoId>` (upload-pack);
  container git verbs work; a commit made in the container **pushes back through the JGit server**
  (receive-pack) and shows up as origin-side `ahead 1`. Two real bugs were found and fixed this
  way: (1) `docker exec … kill` runs `kill` as a bare executable absent from minimal images — now
  routed through `sh -c` (shell builtin); (2) `/workspace` is created root-owned at image build but
  the container runs as an arbitrary uid, tripping git's "dubious ownership" guard — the Dockerfile
  now sets `git config --system --add safe.directory '*'` (single-tenant sandbox).

### Reachability caveat (confirmed)

`DockerExecutor` sets `--add-host=host.docker.internal:host-gateway` and the container clones from
`http://<git-host>:<qits-port>/git/…`. On **native Linux docker** `host-gateway` routes to the host
and this works out of the box. On **Docker Desktop + WSL2** it does **not**: `host-gateway` resolves
to Docker Desktop's own gateway (`192.168.65.254` / an IPv6 ULA), which does not forward to a port
bound inside the WSL2 distro — the container gets "connection refused". Two things make it work
there: bind the app dual-stack (`quarkus.http.host=::`) and point `qits.workspace.git-host` at an
address the container can actually reach (e.g. the WSL2 `eth0` IP) instead of `host.docker.internal`.
This is the deferred-hardening reachability limit the design flagged, now pinned to a concrete cause.

## Manual verification checklist

Build `qits/workspace`; start the service; create a repo/workspace (container runs, `/workspace`
cloned from the git server); `docker exec` a command through the registry terminal; terminate
(inner group gone); kill qits and restart (reconciliation finds the container, command reads
INTERRUPTED); commit in the container without pushing → `canCleanupBranch` false, push → true.
