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

## Artifacts

| File | Role |
|---|---|
| `docker/qits/Dockerfile` | The prod app image: `qits/workspace` base + the docker CLI, running the packaged fast-jar. Built with the **repo root** as context; COPYies `service/target/quarkus-app/` (build the app with Maven first). |
| `docker-compose.prod.yml` | The prod stack: the qits service on `qits-net`, socket mount, `group_add` for socket access, state + shared volumes, healthcheck. |
| `docker/workspace/Dockerfile` | The image **every workspace** runs. Must exist on the server (`qits/workspace:latest`) or workspaces can't start. |

## Continuous deployment (GHCR + Watchtower)

`.github/workflows/deploy.yml` runs on every push to `main`: it builds + unit-tests the reactor, then
builds and pushes **two** images to GHCR — `ghcr.io/wohlben/qits` (the app) and
`ghcr.io/wohlben/qits-workspace` (the toolchain, which is also the app image's base). No server
credentials are needed; `GITHUB_TOKEN` pushes to GHCR.

The **server deploys itself**: the `watchtower` service in `docker-compose.prod.yml` polls GHCR every
120s and, when `ghcr.io/wohlben/qits:latest` changes, pulls it and recreates the qits container with
the same config. It only touches the labelled qits container. If the GHCR packages are **private**,
give Watchtower a pull token (uncomment its `config.json` mount); public packages need no auth.

Watchtower does **not** update the workspace image (it's used to *create* containers, not run one).
After a `qits-workspace` change, refresh the server: `docker pull ghcr.io/wohlben/qits-workspace:latest`
(a cron is fine — it changes rarely).

## First-time server setup

### One-liner (bootstrap)

`install.sh` self-fetches the compose file, pulls the images, writes `.env`, and brings the stack up
— no repo checkout needed. On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/wohlben/qits/main/install.sh | bash
```

Overridable via env, e.g. a tag and a private-registry login beforehand:

```bash
docker login ghcr.io                                   # only if the GHCR packages are private
QITS_REF=v1.0.0 bash -c 'curl -fsSL "https://raw.githubusercontent.com/wohlben/qits/$QITS_REF/install.sh" | bash'
```

Re-running is safe (idempotent). Use `./install.sh --build` from a full `git clone` to build the
images locally instead of pulling from GHCR. The manual steps below are the same thing by hand.

### Manual steps

The `qits-net` network and the shared volumes are **created by compose on the first `up`** (and qits
self-provisions them at startup too), so there's nothing to pre-create.

```bash
# 1. Both images present on the server. Pull from GHCR (CI publishes them)…
docker pull ghcr.io/wohlben/qits:latest
docker pull ghcr.io/wohlben/qits-workspace:latest
# …or build locally: docker build -t qits/workspace docker/workspace
#                     ./mvnw -pl service -am package -DskipTests
#                     docker build -t ghcr.io/wohlben/qits:latest -f docker/qits/Dockerfile .

# 2. Tell compose the host docker socket's group id (so the non-root qits user can drive it).
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" > .env
echo "TZ=$(cat /etc/timezone 2>/dev/null || echo Etc/UTC)" >> .env

# 3. Up. Compose creates qits-net + the shared volumes here.
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

The app upgrades **automatically** — push to `main`, CI publishes `ghcr.io/wohlben/qits:latest`,
Watchtower on the server pulls and recreates within its poll interval. To force it manually:

```bash
docker compose -f docker-compose.prod.yml pull qits
docker compose -f docker-compose.prod.yml up -d qits
```

Running workspace containers are unaffected by a qits restart (they're siblings); they re-materialize
lazily on next use. The `qits-workspace` image updates only on an explicit `docker pull` (see the CD
section) — it changes rarely, only when the toolchain does.
