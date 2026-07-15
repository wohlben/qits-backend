# Deploying qits to a Linux server (Docker)

The current contract for running qits in production on a single Linux server with Docker. Updated in
place when a change alters it.

## Introduction

Related/dependent plans:

- `.devcontainer/` (`docs/features/2026-07-07_qits-net-devcontainer-unification.md`) — the dev stack
  this deployment mirrors. The prod image is the devcontainer minus the IDE/dev-user bits.
- `docs/features/2026-07-04_workspace-containers.md`,
  `docs/features/2026-07-08_lazy-workspace-container-provisioning.md` — why qits needs the docker
  socket and the shared network.
- `QitsHostResolver` / `qits.workspace.git-host` — how workspace containers address qits.
- `docs/features/2026-07-04_container-agent-sessions.md` — the shared Claude Code login volume.

## The one thing that shapes everything

qits is not a stateless web app: at runtime it shells the `docker` CLI against the **host** daemon to
create **sibling** workspace containers, and it must sit on the shared `qits-net` network so those
containers reach it back by DNS name (git clone/push over `/git`, OTLP over `/api/otel`, MCP over
`/mcp`). So qits runs as a container that:

- bind-mounts `/var/run/docker.sock` (docker-outside-of-docker — sibling containers, not children),
- joins `qits-net` with the network **alias `qits`**, and runs with `qits.workspace.git-host=qits`,
- persists its state (H2 DB + cloned repositories) on a named volume.

## The deployment model: local build, in a throwaway container

Deployment is **manual and pull-nothing**: the server builds the images itself from a source checkout.
There is no registry, no CI push, and no auto-updater — an upgrade is just "run the installer again".

The installer runs **inside a throwaway generic container** with the host docker socket mounted, so the
clone and the (heavy) Maven + Angular + Playwright builds all happen *in that container*. Every
`docker build` / `docker compose` it runs talks to the **host** daemon through the mounted socket, so
the only things left on the host afterwards are the two built images and the running qits stack (plus
its named volumes). The source checkout, Maven/pnpm downloads, and the installer container itself
vanish on `--rm`. Nothing leaks to the host beyond the final product.

## Artifacts

| File | Role |
|---|---|
| `docker/qits/Dockerfile` | The prod app image, **multi-stage**: a `build` stage (`FROM qits/workspace`) packages the fast-jar from source *inside the image build*; the runtime stage adds the docker CLI + a non-root `qits` user and runs it. Built with the **repo root** as context. |
| `docker-compose.prod.yml` | The prod stack: the single qits service on `qits-net`, socket mount, `group_add` for socket access, state + shared volumes, healthcheck. Uses the locally-built `qits/app:latest` (`pull_policy: never`). |
| `docker/workspace/Dockerfile` | The image **every workspace** runs — and the base of the app image. Built locally as `qits/workspace:latest`; must exist on the server or workspaces can't start. |
| `install.sh` | Runs inside the throwaway container: clone → build both images → `.env` → `compose up`. |
| `.github/workflows/ci.yml` | CI **gate only** (build + unit-test on push/PR). No image push, no deploy — the server builds from source. |

## First-time server setup

### One-liner (the throwaway-container install)

From the server host, launch a generic container with the docker socket mounted and pipe the installer
into it. `docker:cli` is a fine generic image; it just needs `bash git curl` added:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  docker:cli sh -c '\
    apk add --no-cache bash git curl >/dev/null && \
    curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
```

Pin a tag/branch with `-e QITS_REF=v1.0.0` (and swap it into the raw URL). When it finishes, qits is
running on `qits-net` and nothing but the two images + the stack remains on the host.

> The build is heavy (first run pulls the JDK/Playwright/coding-agent layers and downloads Maven +
> pnpm deps) — budget ~15 min on a cold host. Re-runs reuse the host's docker layer cache.

### By hand (equivalent, from a real checkout on the host)

`qits-net` and the `qits_shared_*` volumes are declared **`external`** in the compose file: qits itself
(and the workspace containers it spawns) create them as plain `docker network/volume create` resources,
so compose must not try to own them. Ensure they exist first — all four commands are no-ops if they do.

```bash
git clone --depth 1 https://github.com/wohlben/qits-backend.git && cd qits-backend

# 1. Build both images locally (no submodules needed — the app build skips tests + the fixture derive).
docker build -t qits/workspace:latest docker/workspace
docker build -t qits/app:latest -f docker/qits/Dockerfile .

# 2. Tell compose the host docker socket's group id (so the non-root qits user can drive it).
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" > .env
echo "TZ=$(cat /etc/timezone 2>/dev/null || echo Etc/UTC)" >> .env

# 3. Ensure the external network + shared volumes exist (idempotent), then up.
docker network inspect qits-net >/dev/null 2>&1 || docker network create qits-net
for v in qits_shared_dot_claude qits_shared_m2 qits_shared_pnpm; do
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v"; done
docker compose -f docker-compose.prod.yml up -d

# 4. One-time coding-agent (Claude Code) OAuth login onto the now-created shared volume (optional —
#    skip if you don't use the agent; it just won't be available until you do).
bash docker/workspace/agent-login.sh
```

## Ingress / auth

There is **no authentication in qits itself** — the app exposes git push (`/git`), MCP (`/mcp`), and
through the mounted socket, effectively the host docker daemon. It MUST NOT be exposed
unauthenticated. `docker-compose.prod.yml` publishes **no host port**: front qits with your
reverse/forward-auth proxy by putting the proxy on `qits-net` (or attaching qits to the proxy's
network) and routing it to `http://qits:8080`. The `ports:` block is commented out for local
debugging only.

Quarkus binds `0.0.0.0` inside the container (set in the image) and serves both the REST API and the
baked Angular SPA on `:8080` — there is no separate frontend to deploy and no `:4200` in prod.

## Configuration knobs (compose `environment:`)

Every `application.properties` key maps to an env var. The prod-relevant ones:

- `QITS_WORKSPACE_GIT_HOST=qits` — the network alias; keep in sync with the compose alias.
- `QITS_WORKSPACE_IMAGE=qits/workspace:latest` — the locally-built workspace image (no registry).
- `QITS_SPEECH_WARMUP_ON_START` — `false` by default here (skips the ~700 MB model download at boot).
  Flip to `true` when you want server-side transcription live.
- `QITS_GIT_AUTHOR_NAME` / `QITS_GIT_AUTHOR_EMAIL` — the bot identity qits' manufactured commits use.
- `TZ` — wall-clock zone, propagated to every workspace container.

## State & backups

All durable state is the **`qits-data`** volume (`/home/qits/.qits`): the H2 file DB
(`data/h2/qits`) and the cloned bare origins (`data/repositories`). Back it up. The three
`qits_shared_*` volumes are caches + the agent login (re-creatable; the agent login needs a
re-`agent-login.sh` if lost). qits runs on **H2** — single node; it does not scale to multiple
replicas. The Postgres path is stubbed in `domain/pom.xml` if you outgrow single-node.

## Health

`GET /q/health/ready` (readiness) and `/q/health/live` (liveness) via SmallRye Health — the compose
healthcheck polls readiness. Wire the same into your orchestrator/proxy.

## Upgrades / redeploy

Upgrades are **manual**: re-run the installer (the same one-liner). It re-fetches the ref, rebuilds
`qits/workspace:latest` + `qits/app:latest`, and `compose up -d` recreates the qits container with the
new image. To upgrade by hand from a checkout, `git pull` then repeat the two `docker build`s and
`docker compose -f docker-compose.prod.yml up -d`.

Running workspace containers are unaffected by a qits restart (they're siblings); they re-materialize
lazily on next use. The `qits-workspace` image is rebuilt by the same installer run — it changes
rarely, only when the toolchain does.
