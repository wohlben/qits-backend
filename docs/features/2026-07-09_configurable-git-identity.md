# Configurable git identity, provided to workspace containers via env

## Introduction

Today every commit qits creates — the synthetic merges it manufactures host-side, the merge
commits it makes inside a workspace container, and any commit the coding agent or an action makes
in a workspace — is authored by a **hardcoded, scattered** `qits@local` / `qits` identity (or, on
the host-side merge path, by *nobody* — it relies on ambient `~/.gitconfig`, which is the bug this
idea subsumes). This feature makes the identity **a single configurable value in the application**
and **flows it to workspace containers via environment variables**, so the same name/email is used
everywhere a commit is made and can be set once (e.g. to a real bot identity, or the operator's
own) without editing code.

This started as the bug **host-side-merge-needs-ambient-git-identity** (its issue doc is folded
into this section): `SeedServiceTest.seedsFastForwardableAndDivergedWorkspaces` fails in a
container with no git identity because `WorkspaceService.mergeIntoTarget`'s host-side `git merge`
supplies none and falls back to ambient `user.email`, which is absent in fresh containers / CI:

```
InternalServerErrorException: Git merge failed: Command failed [128]: git merge feeder -m Merge feeder into mainline
Committer identity unknown
fatal: unable to auto-detect email address (got 'dev@cba3b934205e.(none)')
```

Rather than paper over that one call site with another inline `-c user.email=qits@local`, this idea
makes the identity a **first-class, single-sourced config value** and fixes every commit path at
once — the host-side gap included.

Related/dependent plans:

- **[workspace-containers](../features/2026-07-04_workspace-containers.md)** — the container-side
  git verbs already solved committer identity *correctly but by hardcoding it*: provisioning runs
  `git config user.email qits@local` in the clone (`WorkspaceService.java:119-122`) and the
  container-side merge passes `-c user.email=qits@local -c user.name=qits` inline
  (`WorkspaceService.java:1027-1030`). This idea replaces those literals with the configured value
  and, crucially, delivers it as container **env** so *any* in-container commit (the coding agent,
  an action script, an ad-hoc `git commit`) inherits it — not only the two verbs qits itself runs.
- **The `seed` command** ([project-domain](../features/2026-05-01_project-domain.md) era) — the
  caller the original bug bit: it manufactures the diverged branch tree via host-side merges in
  `mergeIntoTarget`. It becomes the regression fixture for the identity-less environment.
- **The coding agent** ([container-agent-sessions](../features/2026-07-04_container-agent-sessions.md)) —
  commits the agent makes in `/workspace` currently pick up the provisioning-time `git config`.
  Once identity is env-delivered, the agent's commits carry the configured identity for free, and
  it becomes the natural place a *per-actor* identity could later plug in (see Deferred).
- **Config style** — follows the existing `qits.workspace.*` `@ConfigProperty` family
  (`WorkspaceContainerFactory`, `QitsHostResolver`, …); no new settings entity, no DB, no UI. Set
  via `application.properties` or env like every other `qits.*` knob.

## The problem, concretely

The identity qits commits under lives in **three** places, two of them literal and one absent:

| Site | File:line | Today |
|---|---|---|
| Container provisioning | `WorkspaceService.java:119-122` | `git config user.email qits@local` / `user.name qits` in the clone |
| Container-side merge | `WorkspaceService.java:1027-1030` | inline `-c user.email=qits@local -c user.name=qits` |
| **Host-side merge** | `WorkspaceService.java:905-913` | **nothing** — falls back to ambient `~/.gitconfig` ⇒ the bug |

Three problems fall out:

1. **The host-side gap is a latent failure** wherever `~/.gitconfig` is absent (fresh containers,
   CI, `devcontainer up` without VS Code copying the host gitconfig in). Intermittent across
   environments, not flaky in itself.
2. **The value is unconfigurable.** An operator who wants qits' commits attributed to a real bot
   account (`qits-bot@example.com`) or to themselves must edit and rebuild.
3. **The env-vs-`git config` split leaks.** Provisioning writes `.git/config` in the clone, so only
   commits made *in that clone with that config* get the identity. A commit made in a different cwd,
   or by a tool that resets config, or the agent in a sub-checkout, silently reverts to ambient.
   Env variables (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`) are inherited by *every* `git` process in the
   container regardless of cwd or `.git/config`, closing that leak.

## The model: one config-backed identity, delivered as env everywhere

### Config surface

A tiny `@ApplicationScoped GitIdentity` holder in `domain.repository.control` (or a shared
`domain.config`), reading two properties with the current literals as defaults so behaviour is
unchanged out of the box:

```java
@ConfigProperty(name = "qits.git.author-name",  defaultValue = "qits") String name;
@ConfigProperty(name = "qits.git.author-email", defaultValue = "qits@local") String email;
```

Exposing helpers the two consumers need:

- `envMap()` → `{GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL}` for
  the container factory (author *and* committer, so both halves of a commit are attributed).
- `inlineArgs()` → `["-c", "user.email=<email>", "-c", "user.name=<name>"]` for the host-side merge
  (a host `git` process qits spawns directly, where env-injection isn't as clean as `-c`).

Single source of truth; the literals disappear from the call sites.

### Delivery to containers: env, not `git config`

`WorkspaceContainerFactory.forWorkspace` sets the four `GIT_*` env vars on the container (the same
place `TZ`, `CLAUDE_CONFIG_DIR`, `MAVEN_OPTS` are set), so **every** `docker exec … git …` in that
container — qits' own verbs, the agent, actions, an interactive shell — inherits the identity with
no `.git/config` dependency. The provisioning-time `git config user.email/user.name` calls
(`WorkspaceService.java:119-122`) become redundant and are removed (env supersedes them; git's
precedence is `GIT_*COMMITTER*` env over `.git/config` for the committer, and `GIT_AUTHOR_*` for the
author). The container-side merge's inline `-c` args (`1027-1030`) also become redundant — the env
already covers it — so that call simplifies back to a plain `git merge --no-edit`.

### Host-side merge: inline `-c`

`mergeIntoTarget`'s host `git merge` (`WorkspaceService.java:905-913`) — spawned by `GitExecutor`
directly on the host, not through a container — gets `GitIdentity.inlineArgs()` spliced in:
`git -c user.email=<email> -c user.name=<name> merge …`. This is the actual bug fix, now sourced
from the same config as everything else. (Splicing `-c` is preferred over setting env on the host
`ProcessBuilder` so it's explicit at the one synthetic-commit call site and can't leak into other
host `git` invocations.)

## What changes, file by file

- **New** `GitIdentity` (`domain`, `@ApplicationScoped`) — the two `@ConfigProperty`s + `envMap()` /
  `inlineArgs()`.
- `WorkspaceContainerFactory.forWorkspace` — inject `GitIdentity`, `.env(...)` the four `GIT_*`
  vars.
- `WorkspaceService` — inject `GitIdentity`; remove the provisioning `git config` calls
  (119-122); drop the inline `-c` from the container-side merge (1027-1030, now env-covered); splice
  `inlineArgs()` into the host-side merge (905-913). Update the `qits@local` mentions in the
  provisioning Javadoc (94, 118).
- `GitExecutor` — no change (it already forwards argv verbatim; the `-c` flags are just more argv).

No REST/DTO/MCP/UI surface, no migration, no openapi regen — this is a config + internal-plumbing
change.

## Seed / fixture / testing

- **Regression test (the original bug).** `SeedServiceTest.seedsFastForwardableAndDivergedWorkspaces`
  already exercises the host-side merge path; it just needs to bite in an **identity-less
  environment**. Make the test run `git merge` with no ambient identity available — e.g. run the
  host merge with `HOME` pointed at an empty dir / `GIT_CONFIG_GLOBAL=/dev/null` and
  `GIT_CONFIG_SYSTEM=/dev/null` so the only identity that can satisfy the commit is the one
  `mergeIntoTarget` now supplies. Without the fix it reproduces `Committer identity unknown`; with
  it, it passes and the merge commit is authored by the configured identity. This is the guard that
  keeps the ambient-identity dependency from creeping back.
- **`GitIdentity` unit test** — defaults are `qits` / `qits@local`; overriding
  `qits.git.author-name` / `qits.git.author-email` (via `@TestProfile` or
  `application.properties`) flows through `envMap()` / `inlineArgs()`.
- **Container-side attribution** — a `WorkspaceService`/`FakeContainerRuntime` test asserts a commit
  made in the container (via the merge path) is authored/committed by the configured identity, and
  that the container was created with the four `GIT_*` env vars set (assert on the recorded run
  argv). Because `FakeContainerRuntime` runs real host processes, `git log --format='%an <%ae>'`
  verifies attribution end-to-end.
- **Config override** — a profile setting `qits.git.author-email=qits-bot@example.com` produces
  commits attributed to that address on both the host and container paths.

## Explicitly deferred

- **Per-actor identity.** Attributing the coding agent's commits to a *distinct* identity
  (e.g. `agent@qits.local`) or to the human who launched the workspace, versus qits' own
  bookkeeping merges. The env delivery makes this a natural later split (the agent launch could
  override `GIT_AUTHOR_*` for its own `docker exec`s), but iteration one is a single global
  identity.
- **Per-project / per-workspace identity.** A commit identity configured on the `Project` or
  `Workspace` entity (DB-backed, UI-editable) rather than a global `qits.git.*` property. That would
  need an entity field, a migration, and a settings UI — out of scope for a config-only change, and
  only worth it once there's a real multi-tenant need.
- **Signing (GPG/SSH).** Signed synthetic commits are a separate concern with their own key-material
  and container-secret story; not part of identity.
- **A real bot account with push credentials.** This idea only sets *authorship*; it does not
  provision credentials for pushing to an external remote — qits pushes only to its own in-process
  origins.

## Open questions

- **Author vs committer split.** Setting all four `GIT_*` vars makes author == committer. If a
  future per-actor idea wants "authored by the agent, committed by qits," the env delivery already
  supports it (set `GIT_AUTHOR_*` per exec, keep `GIT_COMMITTER_*` global) — confirm nothing today
  depends on them differing.
- **Precedence sanity.** Verify `GIT_COMMITTER_*` env reliably wins over a stale `.git/config`
  `user.*` in the clone across the git versions in the base image, so removing the provisioning
  `git config` calls can't be undone by a leftover config value. (It should — env beats config for
  identity — but pin it with the attribution test above.)
- **Should the host-side merge use env too, for symmetry?** Chosen `-c` for explicitness at the one
  synthetic-commit site; revisit if more host-side commit paths appear and a shared env becomes
  cleaner than repeating `inlineArgs()`.
