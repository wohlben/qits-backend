# CI post-receive pipeline (MVP)

## Introduction

The founding part of the [qits-ci epic](../epic.md): qits' own CI pipeline format as a **quality
gate**. A repository opts in by committing **`.config/qits/ci-post-receive.yml`** — the file is
named after the git **server-side hook event** that fires it (`pre-receive` → `update` →
**`post-receive`** → `post-update`; post-receive is the one that runs after a push's ref updates
have landed, which is exactly when a CI run should start). When a push arrives at the repo's bare
origin through the in-process git host, qits reads the config **from the pushed commit**, runs each
step's bash script in a container of the step's declared image, and records a per-step pass/fail
for that push.

Per the [epic](../epic.md), ci is **modelled as a separate service** hosted here only temporarily:
a self-contained **`ci/` library module** on the [qits-artifacts](../../qits-artifacts/features/2026-07-19_qits-artifacts.md)
template — no dependency on `domain` or `auth/*`, its own named datasource + persistence unit +
Flyway lineage, repos referenced by string id (never FK), its own REST boundary indexed by
`service` — so the later extraction into a standalone deployable is a lift-and-wire.

Related / dependent plans:

- **Module template** — [qits-artifacts](../../qits-artifacts/features/2026-07-19_qits-artifacts.md)
  and its pending [standalone split](../../qits-artifacts/feature-ideas/standalone-artifacts-service.md):
  the "self-contained library module, boundary hosted by `service` for now" pattern this part
  copies, including the static write token and the own-H2 discipline.
- **Trigger** — the git host (`eu.wohlben.qits.githost.GitHostRoutes`): JGit's `ReceivePack` has a
  `setPostReceiveHook` seam that fires per push with the ref updates (branch, old/new sha) — the
  literal implementation of the event the filename names. The hook delivers the event to ci over
  its HTTP intake, the wire contract an extracted ci keeps unchanged.
- **Execution** — [workspace containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md)
  are the pattern, not a dependency: a CI step is a short-lived sibling of a workspace container
  (fresh container per step on `qits-net`, clone from the git host, no persistence), but ci shells
  `docker` through its **own small executor** rather than `domain`'s `ContainerRuntime`, so the
  runner leaves with the module.
- **In-repo config precedent** — [`.qits-config` in-repo configuration](../../qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md):
  like `.qits-config.yml`, the CI config is read from the repository, never ingested into DB rows —
  the commit is the source of truth. CI configs open the new `.config/qits/` directory.
- **Follow-up consumers** (explicitly out of scope here): step logs/outputs into
  [qits-artifacts](../../qits-artifacts/epic.md); **enforcing** the gate by blocking branch
  integration on a red pipeline; more events (`pre-receive` as a *rejecting* gate) once the runner
  exists.

## Motivation

qits provisions workspaces, runs actions, and integrates branches — but nothing verifies a pushed
commit *automatically*. Feature flows are user-triggered and DB-configured; what's missing is the
CI half: verification that is **committed next to the code it verifies**, versioned with it, and
triggered by the push itself. Building our own format (instead of adopting one) keeps it aligned
with qits' primitives — the git host is the event source, workspace-style containers are the
runners, and the config-in-repo philosophy already governs `.qits-config.yml`. The MVP is the
smallest loop that closes: push → read config at pushed sha → run steps → record green/red.

## Config format (MVP)

`.config/qits/ci-post-receive.yml`, a single top-level `steps` key — a list, executed
**sequentially**, each entry a bash script plus the image it runs in:

```yaml
steps:
  - image: maven:3.9-eclipse-temurin-25
    script: ./mvnw verify
  - image: node:22
    script: |
      corepack enable
      pnpm install --frozen-lockfile
      pnpm test
```

- `script` *(required)* — passed to `bash -c` (multi-line via YAML block scalar). Non-zero exit
  fails the step; a failed step fails the run and skips the remaining steps.
- `image` *(required)* — the full `$image:$tag` reference the step's container runs.

That's the whole schema. Parsing is **lenient**: unknown keys (top-level or per-step) are ignored,
so a repo can carry config for a newer qits-ci without breaking on an older one; only a missing
`script`/`image` or unparseable YAML is a config error. The format will expand a lot later —
per-step names, `needs`/parallelism, caching, artifacts, variables — all additive over the `steps`
core.

## Design sketch

- **Module**: new top-level **`ci/`** library module (`eu.wohlben.qits.ci`, BCE split +
  framework-free `error/`), depending on **neither `domain` nor `auth/*`**. Runs and steps
  reference repositories and branches by **string id/name only, never FK** — an extracted ci has
  no access to qits' tables, so the in-repo incarnation must not either. Config defaults ship in
  its `META-INF/microprofile-config.properties`; `service` indexes it via
  `quarkus.index-dependency.ci.*` and (for now) hosts its REST boundary. `-pl ci` never needs
  `-Dqits.variant`.
- **Trigger**: `GitHostRoutes` sets a post-receive hook on the `ReceivePack` it builds per request.
  For each updated **branch** ref the hook `POST`s `{repoId, branch, oldSha, newSha}` to ci's
  event intake `POST /api/ci/events/post-receive` (fire-and-forget — the push response never waits
  on CI), guarded by a static **`qits.ci.token`** exactly like `qits.artifacts.token` (blank ⇒
  open dev/test). Today that request goes to qits' own port; after extraction the git host posts
  to `http://qits-ci:<port>/…` with the identical payload. Deletions and non-branch refs are
  ignored. Host-side pushes by `GitExecutor` (seeds, integration merges) do not pass through the
  git host and therefore do not trigger runs in the MVP — the event is genuinely "a push was
  received".
- **Config read**: ci never touches the bare origins on disk (an extracted service has no shared
  filesystem). It shells its **own `git`** against the git host's smart-HTTP URL — the same
  `http://<QitsHostResolver.qitsHost()>:<port>/git/<repoId>` workspace containers clone from —
  fetching the pushed sha into a per-repo bare cache under its own data dir, then reading the blob
  (`git show <sha>:.config/qits/ci-post-receive.yml`). Absent file ⇒ no run (opt-in, recorded
  nowhere). Unparseable file or a step missing `script`/`image` ⇒ a run in status `CONFIG_ERROR`,
  so a broken gate is visible rather than silently green (unknown keys are fine — see leniency
  above).
- **Execution**: one fresh container per step — `docker run` the step's `image` on `qits-net` via
  ci's own thin docker shell-out (mirroring `DockerExecutor`'s CLI approach, not reusing it),
  clone the repo at `newSha` into `/workspace` from the git host URL, then `bash -c <script>` with
  CWD `/workspace`; remove the container afterwards. Steps of one run are sequential; each step
  gets a fresh clone (no state crosses steps in the MVP — caching is a follow-up).
- **Persistence**: ci owns its **own named datasource + persistence unit + Flyway lineage** — a
  separate H2 under `~/.qits/data/ci`, migrations at `db/ci/migration` — so extraction moves
  files, not data. Entities: `CiRun` (repoId, branch, commit sha, status
  `RUNNING|SUCCESS|FAILED|CONFIG_ERROR`, timestamps) with `CiStep` children (index, image, status,
  exit code, captured combined output — bounded, tail-truncated). No cascade from qits' aggregate:
  deleting a repository leaves runs behind as dangling history (cleanup is a follow-up concern,
  same stance artifacts takes with its string-metadata references).
- **Surface** (minimal, all under `/api/ci`, hidden from OpenAPI like artifacts):
  `GET /api/ci/repositories/{repoId}/runs` (+ single run with steps/output) so the gate is
  *visible* per branch; reads are open, the only write surface is the token-guarded event intake.
  No UI polish, no re-run button, no live streaming — read-only JSON is enough to call the loop
  closed; the frontend tab and gate enforcement are follow-ups.

## Out of scope (follow-ups, parked in the epic)

- **The extraction itself** — epic part 2 (`standalone-ci-service`): a small Quarkus-app module
  hosting `ci` as its own server (alias `qits-ci` on `qits-net`). This part only keeps the
  boundary extraction-clean.
- Enforcing the gate (blocking integration on red) — MVP is advisory: status is recorded and
  queryable, nothing blocks.
- Other events (`ci-pre-receive.yml` as a push-rejecting gate needs synchronous execution and a
  very different latency budget).
- Parallel steps, caching, artifacts upload, secrets/variables, per-step timeouts beyond a single
  conservative default, log streaming.
- Run cleanup when a repository is deleted (runs reference repos by string id and simply go stale,
  like artifacts blobs).

## Testing sketch

- Unit (`-pl ci`): config parsing (happy, multi-line script, unknown keys ignored, malformed YAML
  and missing `script`/`image` ⇒ `CONFIG_ERROR`), run/step state transitions, output truncation.
- Boundary (`service` suite): a push through the real git host fires the intake; assert a run with
  the expected steps/status via the REST surface, plus the token guard (401 without, blank-token
  dev openness). Since ci cannot see `domain`'s `FakeContainerRuntime`, ci ships its **own fake
  runner seam** (`@Mock` in its `src/test`, running scripts as host processes) so the suites stay
  docker-free.
- Extended (`-Pextended`, real docker): one IT pushing a commit whose config runs a trivial step in
  a real image, asserting `SUCCESS` and captured output; one asserting a failing script yields
  `FAILED` with the exit code.
