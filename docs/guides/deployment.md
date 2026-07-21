# Deploying qits to a Linux server (Docker)

The current contract for running qits in production on a single Linux server with Docker. Updated in
place when a change alters it.

## Introduction

Related/dependent plans:

- `.devcontainer/` (`docs/epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md`) — the dev stack
  this deployment mirrors. The prod image is the devcontainer minus the IDE/dev-user bits.
- `docs/epics/qits-workspaces/features/2026-07-04_workspace-containers.md`,
  `docs/epics/qits-workspaces/features/2026-07-08_lazy-workspace-container-provisioning.md` — why qits needs the docker
  socket and the shared network.
- `QitsHostResolver` / `qits.workspace.git-host` — how workspace containers address qits.
- `docs/epics/qits-coding-agents/features/2026-07-04_container-agent-sessions.md` — the shared coding-agent login volume.
- `docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md` — auth is a BUILD variant (`forwardauth` |
  `oauth`), selected at install time; the "Ingress / auth" section below is the deployment side of
  that design.

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
| `docker/qits/Dockerfile` | The single Dockerfile for **both** qits images, as stages — fully self-contained, no stage resolves an external image: `workspace` (the toolchain image every workspace container runs; tag it via `--target workspace`), `build` (packages the fast-jar from source *inside* the image build), and the runtime stage (docker CLI + a non-root `qits` user). Built with the **repo root** as context. |
| `docker-compose.prod.yml` | The prod stack: the single qits service on `qits-net`, socket mount, `group_add` for socket access, state + shared volumes, healthcheck. Uses the locally-built `qits/app:latest` (`pull_policy: never`). |
| `docker-compose.dokploy.yml` | Overlay for [Dokploy](https://dokploy.com)-managed deployments: `extends` the qits service from the prod file, adds a `workspace-image` service (tags the Dockerfile's `workspace` stage as `qits/workspace:latest` for runtime workspace spawning), and joins `dokploy-network` so Dokploy's Traefik can route to it. Fully from source in one stack — the self-contained Dockerfile makes build order irrelevant. Full walkthrough in the README's "Deploying with Dokploy" section. |
| `docker/workspace/` | `agent-login.sh` — the one-time coding-agent OAuth login onto the shared volume. (The workspace image's Dockerfile lives in `docker/qits/Dockerfile` as the `workspace` stage.) |
| `install.sh` | Runs inside the throwaway container: clone → build both images → `.env` → `compose up`. |
| `.github/workflows/ci.yml` | CI **gate only** (build + unit-test on push/PR). No image push, no deploy — the server builds from source. |

## First-time server setup

Three equivalent flows: the throwaway-container one-liner (below), the by-hand checkout (below), or —
when the server already runs Dokploy — a Dokploy Compose service on `docker-compose.dokploy.yml`
(walkthrough in the README's "Deploying with Dokploy" section; the one-time prep there covers what
the installer's ensure step normally creates).

### One-liner (the throwaway-container install)

From the server host, launch a generic container with the docker socket mounted and pipe the installer
into it. `docker:cli` is a fine generic image; it just needs `bash git curl` added:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e QITS_VARIANT=forwardauth \
  docker:cli sh -c '\
    apk add --no-cache bash git curl >/dev/null && \
    curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
```

`QITS_VARIANT` is **required** — it names the auth build variant baked into the app image
(`forwardauth` | `oauth`; see "Ingress / auth" below to choose). Because the throwaway container is
all there is — **no checkout, compose file, or `.env` lands on the host** — every deployment setting
travels as further `-e` variables on this same `docker run`: the installer writes the recognized
auth vars (`QUARKUS_OIDC_*`, `QITS_AUTH_*`, `QUARKUS_HTTP_PROXY_*`) into the stack's `.env`, which
the compose service loads via `env_file`. For `oauth` the three `QUARKUS_OIDC_*` values are
mandatory and the installer refuses to build without them. Re-runs (upgrades) must pass the same
`-e` set again — the invocation is the configuration. Pin a tag/branch with `-e QITS_REF=v1.0.0`
(and swap it into the raw URL). When it finishes, qits is running on `qits-net` and nothing but the
two images + the stack remains on the host.

> The build is heavy (first run pulls the JDK/Playwright/coding-agent layers and downloads Maven +
> pnpm deps) — budget ~15 min on a cold host. Re-runs reuse the host's docker layer cache.

### By hand (equivalent, from a real checkout on the host)

`qits-net` and the `qits_shared_*` volumes are declared **`external`** in the compose file: qits itself
(and the workspace containers it spawns) create them as plain `docker network/volume create` resources,
so compose must not try to own them. Ensure they exist first — all four commands are no-ops if they do.

```bash
git clone --depth 1 https://github.com/wohlben/qits-backend.git && cd qits-backend

# 1. Build both images locally (no submodules needed — the app build skips tests + the fixture
#    derive). Both are stages of the single docker/qits/Dockerfile; QITS_VARIANT names the auth
#    build variant (forwardauth | oauth) — required, no default.
docker build -t qits/workspace:latest --target workspace -f docker/qits/Dockerfile .
docker build -t qits/app:latest --build-arg QITS_VARIANT=forwardauth -f docker/qits/Dockerfile .

# 2. Tell compose the host docker socket's group id (so the non-root qits user can drive it).
#    .env doubles as the container env file (compose `env_file`): append the auth variables for
#    your variant here too (see "Ingress / auth" below) — for oauth the QUARKUS_OIDC_* ones are
#    required or the container won't start.
echo "DOCKER_GID=$(stat -c %g /var/run/docker.sock)" > .env
echo "TZ=$(cat /etc/timezone 2>/dev/null || echo Etc/UTC)" >> .env

# 3. Ensure the external network + shared volumes exist (idempotent), then up.
docker network inspect qits-net >/dev/null 2>&1 || docker network create qits-net
for v in qits_shared_dot_claude qits_shared_m2 qits_shared_pnpm; do
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v"; done
docker compose -f docker-compose.prod.yml up -d

# 4. One-time coding-agent login onto the now-created shared volume (optional — skip if you don't
#    use the agent; it just won't be available until you do). Claude Code OAuth by default;
#    `agent-login.sh kimi` for a Kimi Code deployment (qits.agent.type=kimi).
bash docker/workspace/agent-login.sh
```

## Ingress / auth

qits exposes git push (`/git`), MCP (`/mcp`), and — through the mounted socket — effectively the
host docker daemon. It MUST NOT be exposed unauthenticated. `docker-compose.prod.yml` publishes
**no host port**; front qits with a proxy on `qits-net` (or attach qits to the proxy's network)
routing to `http://qits:8080`. The `ports:` block is commented out for local debugging only.

**Auth is baked into the image at build time** (`docs/epics/qits-authentication/features/2026-07-16_build-variant-auth.md`):
`QITS_VARIANT` at install time picks one of the two variants below, and there is no runtime toggle —
no build of qits runs unauthenticated.

### `QITS_VARIANT=forwardauth`: trust the forward-auth proxy's identity headers

Your reverse/forward-auth proxy (Authelia, oauth2-proxy, Traefik forwardauth, …) does the login and
**injects the authenticated identity as headers**; qits verifies nothing itself and trusts them
unconditionally. qits **401s every UI/API request that lacks the user header** — a proxy that merely
gates traffic without injecting headers is not enough anymore.

Proxy requirements:

- inject the username header on every proxied request (default `Remote-User`; groups optionally in
  `Remote-Groups`, comma-separated) — Authelia's defaults. For oauth2-proxy set
  `QITS_AUTH_FORWARD_USER_HEADER=X-Auth-Request-User` / `QITS_AUTH_FORWARD_GROUPS_HEADER=X-Auth-Request-Groups`.
- **strip client-supplied copies** of those headers (Authelia/oauth2-proxy setups do this by
  default; verify — qits believes whatever arrives).
- never route to qits unauthenticated; qits publishes no host port precisely so the proxy is the
  only way in.

Optional: `QITS_AUTH_REQUIRED_ROLE=<group>` — require that group (from the groups header) on every
protected request.

All of these are plain env vars on the qits container: pass them as `-e` on the installer one-liner
(they land in `.env` → `env_file`), or set them in `.env` directly in a persistent checkout.

### `QITS_VARIANT=oauth`: built-in OIDC against Keycloak (no forward-auth needed)

qits runs SSO itself — a plain TLS-terminating reverse proxy is then enough. qits terminates the
OIDC authorization-code flow (302 to Keycloak before the SPA loads, session in an encrypted
`q_session` cookie, silent refresh, `/api/auth/logout` for RP-initiated logout), and requests
carrying an `Authorization: Bearer <jwt>` are validated resource-server style instead — so
scripts/CLI work with Keycloak-issued tokens too (`quarkus.oidc.application-type=hybrid`).

Environment — **required**, the container fails startup without the OIDC values (deliberate: an
oauth image can never run unauthenticated; the installer checks upfront, before the slow builds).
Pass them as `-e` on the installer one-liner (they land in `.env` → `env_file`), or set them in
`.env` directly in a persistent checkout:

```bash
QUARKUS_OIDC_AUTH_SERVER_URL=https://keycloak.example.com/realms/myrealm
QUARKUS_OIDC_CLIENT_ID=qits
QUARKUS_OIDC_CREDENTIALS_SECRET=<client secret>
# Optional: require a Keycloak realm role on every protected request (unset = any user in the realm)
QITS_AUTH_REQUIRED_ROLE=qits-user
# Behind the TLS-terminating proxy, so redirect URIs come out as https://<public-host>/...:
QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING=true
QUARKUS_HTTP_PROXY_ENABLE_FORWARDED_HOST=true
```

Keycloak client setup: a **confidential** client (Client authentication ON) with **Standard flow**
enabled, *Valid redirect URIs* `https://qits.example.com/*`, and *Valid post logout redirect URIs*
`https://qits.example.com/` (for `/api/auth/logout`). If you must use a **public** client instead,
set `QUARKUS_OIDC_AUTHENTICATION_PKCE_REQUIRED=true` and provide an explicit 32-char
`QUARKUS_OIDC_TOKEN_STATE_MANAGER_ENCRYPTION_SECRET` (normally derived from the client secret).

### What stays public in both variants

Enforced by `QitsAuthPolicy`/`PublicPaths` (auth-core); identical for both variants because this
traffic reaches qits directly on qits-net, bypassing any proxy: `/git/*`, `/mcp/*`, `/api/otel/*`,
`/api/capture`, the per-command `agent-session` report hook, `/q/*` health probes, and
`/api/auth/*`. These are the paths workspace containers and the cross-origin fixture SPA call —
clients that cannot carry a user token. Everything else, including the SPA itself and the
`/daemon/*` web-view proxy, requires an identity.

### Either way

Quarkus binds `0.0.0.0` inside the container (set in the image) and serves both the REST API and the
baked Angular SPA on `:8080` — there is no separate frontend to deploy and no `:4200` in prod.

## Configuration knobs (compose `environment:`)

Every `application.properties` key maps to an env var. The prod-relevant ones:

- `QITS_WORKSPACE_GIT_HOST=qits` — the DNS name workspace containers reach qits by. One `.env`
  value drives both the compose network alias and the runtime config (same interpolation
  default), so they cannot drift. Per-stack unique on multi-stack servers (below).
- `QITS_WORKSPACE_NETWORK=qits-net` — the workspace network. Same one-value-drives-both pattern:
  compose resolves the external network's `name:` from it AND passes it to the app
  (`qits.workspace.network`). Per-stack unique on multi-stack servers (below).
- `QITS_WORKSPACE_IMAGE=qits/workspace:latest` — the locally-built workspace image (no registry).
- `QITS_SPEECH_WARMUP_ON_START` — `false` by default here (skips the ~700 MB model download at boot).
  Flip to `true` when you want server-side transcription live.
- `QITS_GIT_AUTHOR_NAME` / `QITS_GIT_AUTHOR_EMAIL` — the bot identity qits' manufactured commits use.
- `TZ` — wall-clock zone, propagated to every workspace container.

## Running more than one stack on a server (prod + dev)

Each stack MUST get its own workspace network and DNS alias. The network is `external` and the
alias defaults to `qits` — two stacks left on defaults join the SAME network and BOTH answer to
`qits`, so Docker DNS round-robins every container→qits request (git clone/push, OTLP, MCP)
between the stacks: repos that exist on only one stack randomly fail with `repository … not
found`, telemetry and agent MCP calls cross stacks silently
(`docs/issues/2026-07-17_two-stacks-collide-on-qits-net-alias.md` — the prod/dev encounter that
surfaced this).

Keep the first stack on the defaults; for each further stack set, in its `.env` / Dokploy
Environment tab:

```bash
QITS_WORKSPACE_NETWORK=qits-net-dev    # this stack's own network (create once, see below)
QITS_WORKSPACE_GIT_HOST=qits-dev       # this stack's own alias on that network
```

and create the network once: `docker network create qits-net-dev`. Compose resolves the external
network's real `name:` and the alias from these same values, so one setting drives compose and
runtime together. The `qits_shared_*` volumes staying shared across stacks is fine (they are
caches + the agent login); `qits-data` is naturally per-stack (compose-project-scoped).

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
