# Docker CLI stderr pollutes captured command output (observed: commitHash) in prod

> **Root cause of the warning found 2026-07-17**: NOT `HOME` — the container env carried
> `DOCKER_CONFIG=/root/.docker`, injected by Dokploy into the `.env` it writes (its internal
> registry-auth setting) and forwarded into the container by compose `env_file`
> (`docker exec <qits> env | grep -i docker` showed it; `HOME` was correct all along). Mitigated
> in `docker-compose.prod.yml` by pinning `DOCKER_CONFIG: /home/qits/.docker` under
> `environment:`, which beats `env_file`. **The stderr-merging bug below stays open** — captured
> values must be immune to whatever the CLI warns about next, and finished-command transcripts
> already persisted with the warning keep replaying it until re-run.

## Introduction

Related/dependent plans:

- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md` — `DockerExecutor` is the runtime whose
  captured output this corrupts.
- `docs/guides/deployment.md` — the Dokploy prod deployment where it was observed; the trigger is
  a deployment-side `HOME` anomaly (below).
- `docs/issues/2026-07-17_terminal-ws-immediate-disconnect-behind-https-proxy.md` — found while
  diagnosing that issue; this one does NOT explain the WS disconnect (the polluted exec had exit
  code 0, proving docker/container/git all work in prod).

## Observed (prod, 2026-07-17)

Starting a terminal session returns 200 and the persisted command's `commitHash` contains:

```
…Error loading config file: open /root/.docker/config.json: permission denied…
```

That text is the docker CLI's startup *warning* (stderr). Two independent findings:

1. **qits merges stderr into parsed stdout.** `DockerExecutor.runCapturing`
   (`DockerExecutor.java:399`) sets `redirectErrorStream(true)` and the callers treat the merged
   text as the value: `CommandService.java:457-459` stores it as `commitHash` (guarded only by
   exit code — a *warning* on a successful call still corrupts the value). Any docker CLI warning
   (config file, API-version skew, plugin noise) corrupts every parsed value: `rev-parse` output,
   `resolveTarget` inspect fields, workspace `status`/merge probes. `GitExecutor.exec`
   (`GitExecutor.java:39`) has the same merge for git warnings.
2. **The prod qits container runs with `HOME=/root`.** The image sets `ENV HOME=/home/qits`
   (docker/qits/Dockerfile:300, present since the first deploy commit) — with it, the CLI would
   silently skip the missing `/home/qits/.docker/config.json`. "permission denied" on
   `/root/.docker` means the JVM env has `HOME=/root` while running non-root. Something in the
   Dokploy deployment overrides `HOME` (its Environment-tab `.env`? a stale image predating the
   current Dockerfile? check with `docker exec <qits> env | grep -E 'HOME|DOCKER'` and
   `docker inspect <qits> --format '{{.Config.User}} {{.Config.Env}}'`).

## Live confirmation (2026-07-17)

Reproduced against qits.wohlben.eu while root-causing the WS issue: a successful terminal
handshake streams the warning as the PTY's first output, followed by an `I have no name!` bash
prompt (the workspace container's uid has no passwd entry — cosmetic, same as local). So the
warning is emitted by the host-side docker CLI in the qits app container on every invocation,
confirming the container env really has `HOME=/root` despite the image's `ENV HOME=/home/qits`.

## Suggested fix direction

- `DockerExecutor.runCapturing` (and `GitExecutor.exec`): capture stderr separately; return/parse
  stdout only, log stderr at DEBUG (include it in error messages on non-zero exit). Regression
  test: a fake `docker`/`git` on PATH that emits a stderr warning + valid stdout; assert the
  parsed value is clean.
- Belt-and-braces: set `DOCKER_CONFIG` explicitly (e.g. `$HOME/.docker` resolved at startup, or a
  qits-owned dir) on spawned docker CLI processes so a hostile `HOME` can't produce the warning.
- Deployment: find and remove whatever sets `HOME=/root` in the prod container env.

## Data cleanup

Commands persisted while polluted carry a garbage `commit_hash` (the UI shortens it to 7 chars —
`CommandMapper`). Harmless display-wise but worth a cleanup migration or manual fix once the
capture bug is fixed.
