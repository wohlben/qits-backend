# Two qits stacks on one server collide on the shared qits-net `qits` alias

> **RESOLVED 2026-07-17**: the second `qits` turned out to be a leftover container from the
> original install.sh-style deployment still running next to the Dokploy stack (`docker ps`
> showed one `qits/app` after the operator removed it, and the git-host 404s stopped). The
> mechanism below is exactly as diagnosed — two containers answering the `qits` alias on the
> shared external network — and remains one `docker run`/second-stack away, so the compose
> parameterization (`QITS_WORKSPACE_NETWORK`/`QITS_WORKSPACE_GIT_HOST`) and the deployment-guide
> section stay as the guard for intentional multi-stack setups. Move to `resolved/` with the fix
> commit.

## Introduction

Related/dependent plans:

- `docs/guides/deployment.md` / `docker-compose.prod.yml` / `docker-compose.dokploy.yml` — the
  deployment contract this breaks; the fix parameterizes them.
- `docs/features/2026-07-07_qits-net-devcontainer-unification.md` — the design assumption ("qits
  reaches workspace containers by DNS and vice versa over one shared network") that silently
  became "at most ONE qits per server".
- `QitsHostResolver` / `qits.workspace.git-host`, `qits.workspace.network` (DockerExecutor) — the
  two runtime knobs the fix threads through compose.
- `docs/issues/2026-07-17_docker-cli-stderr-pollutes-captured-output.md` — the HOME=/root
  discrepancy there is plausibly explained by inspecting the WRONG stack's app container; recheck
  per stack after separating them.

## Observed (prod server, 2026-07-17)

With prod and dev both deployed via Dokploy on one server, "recreate container" on a workspace of
the qits-backend repo fails:

```
Failed to start the container: Clone into container failed: …
fatal: repository 'http://qits:8080/git/1c73ae85-…/' not found
```

while the same repo's git host answers 200 from outside (https://qits.wohlben.eu/git/…). Probed
from inside a workspace container:

```
$ getent hosts qits
172.19.0.3      qits
172.19.0.2      qits          # ← two app containers answer to the alias
$ for i in 1..6; do curl -o /dev/null -w '%{http_code} ' http://qits:8080/git/1c73ae85-…/info/refs?service=git-upload-pack; done
404 404 404 200 404 200       # ← whichever stack Docker DNS hands out answers
```

## Cause

`docker-compose.prod.yml` hardcodes the network (`qits-net`, external) and the alias/git-host
(`qits`). Every stack on the server therefore joins the SAME network under the SAME name; Docker's
embedded DNS returns both IPs and connections land on a random stack. Any repo/workspace that
exists on one stack but not the other fails ~half of all container→qits traffic: git clone during
materialization (this repro), in-container fetch/push, OTLP export, and agent MCP calls.

## Fix

Parameterize per stack, defaults preserving today's single-stack behavior:

- `docker-compose.prod.yml`: network name `${QITS_WORKSPACE_NETWORK:-qits-net}`, alias +
  `QITS_WORKSPACE_GIT_HOST` from `${QITS_WORKSPACE_GIT_HOST:-qits}` (compose interpolates both
  from the same `.env` the app already loads, so one setting drives compose AND runtime).
- `docker-compose.dokploy.yml`: same interpolation on its `qits-net` reference.
- The second stack sets e.g. `QITS_WORKSPACE_NETWORK=qits-net-dev` /
  `QITS_WORKSPACE_GIT_HOST=qits-dev` in its Dokploy Environment tab and creates the network once
  (`docker network create qits-net-dev`). The `qits_shared_*` volumes staying shared across stacks
  is fine (caches + agent login).

Documented in the deployment guide ("Running more than one stack on a server").
