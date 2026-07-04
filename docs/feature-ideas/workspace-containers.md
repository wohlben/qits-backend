# Workspace containers: sandboxed per-worktree execution (Phase 1 — container, clone, exec)

## Introduction

Everything qits executes — action scripts, dependency installs, dev servers, the coding agent
and every command it decides to run — currently executes directly on the host as the desktop
user. The whole point of qits is to run this *automatically*, and much of it is untrusted by
construction: `pnpm install` runs arbitrary postinstall scripts, dev servers execute repository
code, the agent executes code it just wrote. All of it can read `~/.ssh`, cloud credentials,
`~/.npmrc` tokens, browser profiles — the entire home directory is up for grabs to one
malicious transitive dependency.

This feature makes a **per-worktree Docker container** the execution environment for all of
it. The container sees the repository (cloned from qits' own in-process git server) and nothing
else; the host keeps the credentials, the bare origins, and every trusted git operation.
**Containers are a prerequisite for execution, not a mode — there is no host-execution
fallback.**

This is **Phase 1 of 3**: container lifecycle, getting the code in (in-process git hosting +
clone), and routing command execution through `docker exec`.

Related/dependent plans:

- **Phase 2 — [container-file-access](container-file-access.md)** (depends on this): the
  worktree file browser reads files via `docker exec` instead of host paths.
- **Phase 3 — [container-agent-sessions](container-agent-sessions.md)** (depends on this): the
  coding agent works inside the container; credential hand-off.
- Moves [daemons](../features/2026-07-04_daemons.md) into the container along with all other
  registry execution (daemons launch through the same spawn path) — dissolving the
  port-collision limitation that feature shipped with: every worktree's daemon binds its
  canonical port inside its own container network namespace, so the definition's hardcoded
  port is correct for all worktrees simultaneously.
- The [daemon web-view picker](daemon-webview-picker.md) proxy already resolves targets through
  registry runtime state precisely so port work "lands later without touching it" — the target
  becomes the container's bridge address instead of `127.0.0.1`. The browser keeps reaching
  daemons exclusively through the qits origin, so no container port is ever published to the
  host.
- Rebuilds the launch/terminate path of the
  [command registry](../features/2026-06-30_command-registry.md). Everything above the process
  spawn — ring buffer, re-attach, terminal sockets, audit log — is untouched.
- Reworks the on-disk half of the worktree lifecycle from
  [worktree-history](../features/2026-06-30_worktree-history.md): the host checkout under
  `worktrees/<id>` is replaced by the container's clone. The durable-record model
  (soft-deleted rows, preamble/result, event timeline, commands FK) is unchanged.
- [Repository discovery](../features/2026-05-01_repository-discovery.md)'s worktree
  reconciliation is currently keyed to on-disk worktree metadata files; it moves to container
  labels.

## The decision: full isolation, security first

The port-conflict problem (two worktrees, same daemon, same port) has cheaper fixes — port
templating, loopback aliasing, a bare network namespace. All were considered and all were
rejected for the same reason: they solve ports and nothing else. The credential-exposure
problem justifies filesystem isolation on its own, and once a container exists, ports are
solved as a side effect.

Alternatives rejected:

- **Port templating / loopback aliasing / netns-only**: no credential isolation. Loopback
  aliases additionally die on WSL2 (Windows' localhost forwarding only forwards `127.0.0.1`)
  and on any daemon that binds `0.0.0.0`.
- **Bind-mounting the repo dir into the container at its identical host path**: keeps git
  worktree pointers valid and the host file browser working, but the container keeps writing
  the host filesystem (UID coupling, a shared mutable surface), and it dead-ends short of
  remote execution. Clone-over-protocol gives the container a filesystem it owns outright and
  is the stepping stone to remote nodes.
- **systemd-nspawn**: machine-shaped (boots an OS tree, no image/build/distribution story) —
  Docker's costs without its ecosystem.

Recorded limits of the boundary, so nobody oversells it later:

- Containers share the host kernel — a strong barrier, not a VM.
- Default egress is **open**: a compromised dependency can't read host secrets but can still
  exfiltrate whatever it finds inside the container. Egress allowlisting is deferred hardening.
- The docker socket is **never** mounted into a workspace container — that would be the whole
  boundary handed back.

## Model: a worktree becomes branch + container

The bare `origin` stays the hub on the host; the container is where the branch gets worked on.
Nothing inside the container ever holds credentials for anywhere but the qits-hosted origin —
even a fully compromised workspace cannot `git push` anywhere external.

Worktree creation becomes:

1. Validate ids exactly as today (`WorktreeService.createWorktree`).
2. Create the branch ref host-side in the bare origin (`git branch <newBranch> <parent>` via
   `GitExecutor`) — so ahead/behind readouts and the `merge-tree` conflict probe (both already
   run against origin refs) work from the first second.
3. `docker run` the workspace container (lifecycle below).
4. Init exec: `git clone --branch <newBranch>
   http://host.docker.internal:<qitsPort>/git/<repoId> /workspace` plus a container-local
   `git config user.name/user.email` (`qits@local`, matching the identity `mergeIntoTarget`
   already uses).

Work leaves the container only as `git push origin <branch>`. Integration (merge into target,
cleanup, temp merge worktrees), the branch tree, and history all stay host-side against the
origin — `mergeBranch`/`mergeIntoTarget` already operate on refs plus throwaway worktrees, so
that machinery is unchanged. The host `worktrees/<id>` checkout simply stops existing; the only
host worktrees left are the temporary ones `mergeIntoTarget` creates and removes. The main
branch's worktree is no exception: it too is a container, cloned with the main branch checked
out.

## In-process git hosting: JGit `GitServlet`

The container needs to clone from and push to qits with no separate process — the same shape
as a go-git smart-HTTP server. This is the project's **first JGit dependency**, with a hard
carve-out: **JGit speaks the wire protocol only; the git CLI (`GitExecutor`) remains the only
thing that mutates repositories.** JGit serves the existing bare origins as they sit on disk.

- Dependencies: `org.eclipse.jgit:org.eclipse.jgit.http.server` (+ core JGit), and
  `quarkus-undertow` in `service` to mount a servlet.
- Mount `GitServlet` at `/git/*` with a `RepositoryResolver` that maps `{repoId}` (validated:
  must look like a repo id, no traversal) to `Path.of(dataDir, repoId, "origin")`. Enable
  anonymous upload-pack (clone/fetch) and receive-pack (push).
- Add `/git` to `quarkus.quinoa.ignored-path-prefixes` (same move the web-view picker plans
  for `/daemon`) so the SPA fallback doesn't eat it.
- Reachability: containers resolve the host via `--add-host=host.docker.internal:host-gateway`
  (Linux needs this flag; qits controls container creation, so it is always set). qits must
  listen on an interface reachable from the docker bridge — note this when hardening: the git
  routes are part of the container-facing surface, not browser-only.
- Auth: none for now. Repo ids are UUIDs, so clone URLs are capability URLs — the same trust
  level as the rest of an unauthenticated local qits. Revisit alongside any qits-wide auth.

Alternatives rejected:

- **Embedded unauthenticated sshd**: JGit has no SSH server — this means Apache MINA SSHD,
  host-key generation, an accept-anyone auth layer, a second port, and client-side ceremony in
  every container (`StrictHostKeyChecking=no`). SSH pays key-exchange tolls for auth we
  explicitly don't want; HTTP rides the Quarkus server qits already runs.
- **Hand-rolled smart-HTTP via JAX-RS shelling out to `git upload-pack/receive-pack
  --stateless-rpc`**: zero new dependencies and a perfect `GitExecutor`-philosophy fit, but it
  reimplements pkt-line service headers, gzipped request bodies, and bidirectional streaming —
  a battle-tested implementation of exactly this already exists as `GitServlet`. The carve-out
  rule keeps the philosophical cost contained.

## Container lifecycle: `DockerExecutor`

A `DockerExecutor` in `domain` shells out to the `docker` CLI via `ProcessBuilder` — the
sibling of `GitExecutor`, no docker-java dependency. (The JGit exception is for an in-process
*server*; there is nothing to shell out to for that.)

- Create: `docker run -d --init --name qits-wt-<worktreeId>-<shortRepoId>
  --label qits.repository=<repoId> --label qits.worktree=<worktreeId>
  --add-host=host.docker.internal:host-gateway <image> sleep infinity`.
- Image: one fat default (git + node/pnpm + JDK + python) named by config
  `qits.workspace.image`. Per-repo images / devcontainer.json support is deferred.
- Reconciliation: containers are durable and survive qits restarts. On startup the registry
  reconciles `docker ps -a --filter label=qits.repository` against ACTIVE worktree rows —
  the container-label equivalent of today's metadata-file discovery. Commands that were
  running inside still reconcile to `INTERRUPTED` exactly as today (their exec clients died
  with the JVM).
- Resolve/discard (`doDiscard`): `docker rm -f` the container, delete the branch ref in the
  origin (already happens), soft-delete the row (already happens). No host worktree to remove
  anymore.

## Command execution: the `docker exec` prefix

All execution already funnels through the command registry — that is the single seam. The
spawn line grows a prefix and everything downstream is oblivious:

```
docker exec -it -w /workspace -e KEY=VAL … <container> bash -lc '<script>'
```

- `-w` replaces the ProcessBuilder cwd, `-e` carries the resolved environment, `bash -lc`
  because scripts are shell lines.
- **PTY sessions**: pty4j spawns the `docker exec -it` client; `-t` allocates the inner TTY;
  the docker CLI propagates resize (SIGWINCH) and the inner exit code. Ring buffer, MitM
  capture, re-attach — unchanged.
- **Pipe sessions** (stream-json chats): `-i` without `-t`, stdin ownership unchanged — the
  daemon-event injection point (`CommandRegistry.chatSend`) survives verbatim.
- **Termination is the one real redesign.** Killing the `docker exec` client does *not* kill
  the process inside the container — Docker orphans it alive. The launch wrapper therefore
  records its own pid before exec'ing the script
  (`bash -lc 'echo $$ > /tmp/qits-cmd-<commandId>.pid; exec <script>'`, run under `setsid` so
  the whole process group is addressable), and `terminate()` becomes
  `docker exec <container> kill -TERM -- -<pgid>`, escalating to `-KILL` after the grace
  period, with `docker restart` as the sledgehammer of last resort. This must land in Phase 1's
  `CommandSession` design, not be discovered in production.

## Worktree model changes

- **`Worktree.branch` becomes a column** (+ Flyway migration via `generate-migration`). Today
  the branch is derived from the on-disk checkout (`getCurrentBranch`); there is no disk to
  read anymore. `currentBranchOrNull` and `findWorktreeByBranch` read the column.
- **Worktree-local git verbs become container execs**: the dirty check
  (`isWorktreeClean`, feeding `canCleanupBranch`) runs `git status --porcelain` in the
  container; `fastForwardWorktree` and `updateWorktreeFromParent` become
  `git fetch origin <parent>` + `git merge --ff-only origin/<parent>` (resp. merge with
  abort-on-conflict) inside the container, followed by a push so the origin reflects the
  result.
- **New safety invariant: "fully pushed".** Origin-side ahead/behind cannot see commits that
  exist only inside the container. Cleanup safety (`canCleanupBranch`) additionally requires
  the container's HEAD to equal the origin's branch ref — otherwise unpushed work could be
  destroyed by a "safe" cleanup.
- Host-side unchanged: `listWorktrees` ahead/behind, the `merge-tree` conflict probe,
  `mergeBranch`/`mergeIntoTarget` with temp worktrees, and the whole soft-delete record model.

## Explicitly deferred

- File browsing into the container — **Phase 2**.
- Agent sessions and credential hand-off — **Phase 3**.
- Per-repo images / devcontainer.json support; the fat default image carries iteration one.
- Resource limits (`--memory`, `--cpus` at create time — trivial to add once wanted).
- Egress restriction (allowlist proxy) — the recorded open-egress limit above.
- Remote execution nodes — the git server built here is the stepping stone; everything else
  about remoteness is its own feature.
- Idle-stop/restart policies for containers (they just keep running, like commands: no
  auto-cleanup).
- Migration of pre-existing host worktrees: none. This is a prototype — resolve or reseed;
  the `branch` column backfills from disk where a checkout still exists at migration time.

## Open questions

- **Default image contents and ownership** — one published image, or a locally built
  Dockerfile in the qits repo? How is it versioned/updated?
- **Container user**: `--user $(id -u)` on docker, or rootless podman (container root maps to
  the user, daemonless — friendlier UID story)? `DockerExecutor` should stay
  runtime-agnostic enough to swap.
- **`/workspace` volume**: anonymous (dies with the container) or named (survives container
  recreation, e.g. for an image upgrade without re-cloning)? Lean: anonymous first — a clone
  is cheap to redo locally.
- **Inter-container traffic**: on the default bridge, worktree containers can reach each
  other. Per-worktree networks (or `icc=false`) would make the sandbox boundary
  worktree-shaped instead of qits-shaped. Lean: accept for iteration one, note it next to the
  open-egress limit.
- **Git server exposure** when qits is ever bound beyond localhost — per-repo tokens, or fold
  into whatever qits-wide auth appears?

## Testing sketch

- **Git hosting (`@QuarkusTest`, no docker needed)**: CLI-`git clone
  http://localhost:<testPort>/git/<repoId>` into a temp dir, commit, push, assert the ref
  moved in the bare origin; clone of an unknown repo id → 404; traversal-shaped ids rejected.
- **`DockerExecutor` faked** (interface + test double, like git-less `GitExecutor` tests) for
  unit tests of lifecycle wiring: create-worktree issues branch-create + run + clone-exec in
  order; discard issues `rm -f` + branch delete + soft delete.
- **Real-docker ITs** behind the existing `skipITs` flag: create a worktree → container
  running with the right labels; exec a command → output lands in the ring buffer; terminate →
  inner process group is gone (launch `sleep 300`, terminate, `docker exec ps` shows nothing);
  discard → container removed.
- **Fully-pushed safety**: commit inside the container without pushing → `canCleanupBranch`
  false; push → true.
- **Manual**: seeded repo, create worktree, `docker exec` a dev server, watch it through the
  registry terminal; kill qits, restart, confirm reconciliation finds the container and the
  command shows `INTERRUPTED`.
