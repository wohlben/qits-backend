# qits

A Quarkus-based service for managing Git repositories and workspaces, with an Angular web UI.

## Project Structure

```
qits/
├── pom.xml                          # Root Maven POM (multi-module)
└── service/
    ├── pom.xml                      # Service module POM (Quarkus)
    └── src/
        ├── main/
        │   ├── java/                # Backend (Quarkus, REST API, services)
        │   ├── resources/           # Application config, DB migrations
        │   └── webui/               # Angular frontend (Quinoa default UI dir)
        │       ├── package.json
        │       ├── angular.json
        │       └── src/             # Angular source
        └── test/
            ├── java/                # Unit & integration tests (JUnit)
            └── resources/
                └── fixtures/            # git test fixtures (under the domain module)
                    ├── submodule-*.git/            # tiny bare repos committed as plain files
                    ├── testing-repo/               # submodule → qits-fixture-testing-repo
                    ├── testing-repo-angular/       # submodule → qits-fixture-angular
                    └── testing-repo-quarkus-angular/  # submodule → qits-fixture-quarkus-angular
                                                       #   (its src/main/webui is a nested submodule
                                                       #    → qits-fixture-angular)
```

## Test-fixture submodules

The git test fixtures live under `domain/src/test/resources/fixtures/`. Three of them are **git
submodules** pointing at standalone `github.com/wohlben/qits-fixture-*` repos:

| Submodule dir | GitHub repo | Role |
|---|---|---|
| `testing-repo` | `qits-fixture-testing-repo` | pure git mechanics (clone/pull/divergence) |
| `testing-repo-angular` | `qits-fixture-angular` | the Angular SPA on its own (Angular-only workspace) |
| `testing-repo-quarkus-angular` | `qits-fixture-quarkus-angular` | full-stack app; `src/main/webui` is a **nested submodule** → `qits-fixture-angular` |

Tests and the seeds resolve each fixture as a *bare* repo (`/fixtures/<name>.git`). The build
**derives** those bares from the submodule working trees into `target/test-classes/fixtures/`
(`scripts/derive-fixture-bares.sh`, run automatically as a `runAlways` maven-antrun step — all
offline). You never commit a bare; you bump a submodule pointer.

### Cloning

```bash
git clone --recurse-submodules <repo-url>          # nested: pulls quarkus-angular → angular
# already cloned without it?
git submodule update --init --recursive
```

A build without the submodules initialised fails the fixture-derivation step with a hint to run the
command above.

### Editing a fixture

Fixtures are append-only; treat a branch-tip change as deliberate. The Quarkus+Angular SPA lives in
`qits-fixture-angular`, so a SPA change is a **two-level** round-trip:

```bash
# 1. change + push the SPA
cd domain/src/test/resources/fixtures/testing-repo-angular   # (or the nested .../src/main/webui)
git commit -am "..." && git push
# 2. bump the webui gitlink in the quarkus-angular superproject, push it
# 3. bump the fixture submodule pointer(s) in qits and commit
git add domain/src/test/resources/fixtures/testing-repo-angular
git commit -m "Bump angular fixture"
```

## Frontend

The Angular UI lives at `service/src/main/webui/` — Quinoa's default UI directory. It is built and served via [Quarkus Quinoa](https://quarkiverse.github.io/quarkiverse-docs/quarkus-quinoa/dev/index.html) during development and packaged into the application at build time. Quinoa auto-detects the Angular framework and the pnpm package manager, so no extra `quarkus.quinoa.*` path configuration is required.

## Building & running

```bash
# Full build (all modules, frontend + backend)
./mvnw package

# First on a fresh checkout, build so the `domain` module is resolvable:
./mvnw install -DskipTests

# Run the web app in dev mode (live-reload for both Java and Angular, UI on :4200)
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true

# Seed demo data (a project + branch tree, incl. fast-forwardable / diverged workspaces) into the
# shared local H2 DB so it shows up in the running app. One-step command-mode run, no web server.
# NOTE: `quarkus:run` executes the packaged CLI app, so build it first (`install`/`package` above);
# after a `clean` you must repackage or it fails with "Unable to access jarfile …/quarkus-run.jar".
./mvnw -pl cli -am install -DskipTests && ./mvnw -pl cli quarkus:run -Dcli.args=seed

# Seed the servable Quarkus + Angular demo: a "Quarkus + Angular Demo" project + a repository cloned
# from the testing-repo-quarkus-angular fixture, a web-viewable OTEL-enabled `quarkus:dev` daemon
# (LOG_LEVEL + PATTERN log observers, a FILE log source), a `greeting` workspace, and a "Build &
# Verify" feature-flow blueprint. This exercises the stack-specific feature surface (framework
# detection, the daemon web view, observability, log observation, feature-flows, the coding agent).
# Idempotent by RESET: each run deletes and recreates the project, always returning to the same
# known-good state — so use it as the fixture for manual UI poking and regression tests.
# (Same build prerequisite as `seed` above — package the CLI app before `quarkus:run`.)
./mvnw -pl cli -am install -DskipTests && ./mvnw -pl cli -am quarkus:run -Dcli.args=seed-webapp
```

## Deploying to a server (Docker)

Deployment is **build-on-the-server**: a throwaway container (with the host docker socket mounted)
clones this repo, builds the qits images from source, and brings the stack up — leaving nothing on the
host but the images and the running stack. No registry, no push — and also **no checkout, compose
file, or `.env` on the host**: every deployment setting flows into the installer as `docker run -e`
variables, and upgrades are "run the same command again". (Prefer editing files? Use the persistent
checkout at the end of this section.)

`QITS_VARIANT` names the **auth build variant** baked into the app image at build time — there is no
unauthenticated build and no runtime toggle (`docs/features/2026-07-16_build-variant-auth.md`). Pick
one of the two below. Either way: the first run is slow (it builds the workspace toolchain image +
compiles the app); when it finishes, qits runs on the `qits-net` network (alias `qits`, port 8080, **no
host port published** — your proxy on `qits-net` is the only way in, routing to `http://qits:8080`).
Pin a release with `-e QITS_REF=<tag>`.

### Variant `forwardauth`: your forward-auth proxy owns the login

qits trusts the identity headers the proxy injects — default `Remote-User` (+ groups in
`Remote-Groups`, Authelia's defaults) — and 401s every UI/API request that lacks them. The proxy must
**inject those headers and strip client-supplied copies**; qits believes them unconditionally.

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e QITS_VARIANT=forwardauth \
  docker:cli sh -c '\
    apk add --no-cache bash git curl >/dev/null && \
    curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
```

Then point your forward-auth proxy (Authelia, oauth2-proxy, Traefik forwardauth, …) at
`http://qits:8080`. Optional extra `-e` variables for the same command: different header names (e.g.
oauth2-proxy's) via `-e QITS_AUTH_FORWARD_USER_HEADER=X-Auth-Request-User`
`-e QITS_AUTH_FORWARD_GROUPS_HEADER=X-Auth-Request-Groups`, and a required group via
`-e QITS_AUTH_REQUIRED_ROLE=<group>`.

### Variant `oauth`: qits runs the OIDC login itself (Keycloak)

qits terminates the authorization-code flow (login wall before the SPA, encrypted session cookie,
bearer JWTs for scripts) — a plain TLS-terminating reverse proxy in front is enough, no forward-auth.
The OIDC config is **required and passed on the same command** (the installer refuses to build
without it, because the container would refuse to start):

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e QITS_VARIANT=oauth \
  -e QUARKUS_OIDC_AUTH_SERVER_URL=https://keycloak.example.com/realms/myrealm \
  -e QUARKUS_OIDC_CLIENT_ID=qits \
  -e QUARKUS_OIDC_CREDENTIALS_SECRET=<client secret> \
  -e QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING=true \
  -e QUARKUS_HTTP_PROXY_ENABLE_FORWARDED_HOST=true \
  docker:cli sh -c '\
    apk add --no-cache bash git curl >/dev/null && \
    curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
```

The Keycloak client is a **confidential** client with Standard flow (details incl. redirect URIs in
the deployment guide); the two `QUARKUS_HTTP_PROXY_*` lines make redirect URIs come out as
`https://…` behind the TLS proxy. Optional: `-e QITS_AUTH_REQUIRED_ROLE=<realm role>`.

### Upgrading / switching variants

Re-run the full command — **including all the `-e` variables** (nothing persists on the host, so the
installer invocation *is* the configuration). It re-pulls the ref, rebuilds `qits/app:latest`, and
recreates the container; state (the `qits-data` volume) is untouched. Switching variants is the same
re-run with the other `QITS_VARIANT` and its env — remember to also switch the proxy setup
(forward-auth ↔ plain TLS).

### Alternative: persistent checkout on the host

If you'd rather manage config as files, clone the repo on the server and run the installer from the
checkout — it then builds from your working copy and keeps `.env` (which the compose service loads
via `env_file`) next to `docker-compose.prod.yml`, so re-runs pick your values up without re-passing
`-e`, and `docker compose -f docker-compose.prod.yml up -d` works directly:

```bash
git clone https://github.com/wohlben/qits-backend.git && cd qits-backend
QITS_VARIANT=oauth QUARKUS_OIDC_AUTH_SERVER_URL=… QUARKUS_OIDC_CLIENT_ID=… \
  QUARKUS_OIDC_CREDENTIALS_SECRET=… bash install.sh   # writes the values into .env
# later: edit .env, then
docker compose -f docker-compose.prod.yml up -d
```

### Deploying with Dokploy

If the server already runs [Dokploy](https://dokploy.com), its git-driven Compose deployments +
built-in Traefik replace the installer: Dokploy clones this repo, builds the app image, and runs the
stack from **`docker-compose.dokploy.yml`** — a thin overlay over `docker-compose.prod.yml` that
additionally joins qits to `dokploy-network`, which is how Dokploy's Traefik reaches it (qits still
publishes no host port, and still sits on `qits-net` for its workspace containers).

**One-time server prep** — the host-level pieces `install.sh` normally ensures (Dokploy only manages
the stack itself). On the server:

```bash
git clone --depth 1 https://github.com/wohlben/qits-backend.git /tmp/qits-src
docker build -t qits/workspace:latest /tmp/qits-src/docker/workspace   # slow; toolchain image
docker network create qits-net 2>/dev/null || true
for v in qits_shared_dot_claude qits_shared_m2 qits_shared_pnpm; do docker volume create "$v"; done
```

The `qits/workspace` image is both the app image's build base **and** a runtime dependency (every
workspace container runs it). Dokploy redeploys rebuild only the app image — re-run that
`docker build` by hand when `docker/workspace/` changes (rare, toolchain-only).

**The Dokploy service**:

1. Project → Create Service → **Compose**, type **Docker Compose** (not Stack/Swarm — the stack
   needs `build:` and `group_add`, which swarm doesn't do).
2. Provider: this repo (GitHub or plain Git), branch `main`; **Compose Path:**
   `./docker-compose.dokploy.yml`.
3. **Environment** tab — Dokploy writes these into the `.env` next to the compose file, which the
   qits service loads via `env_file` (same mechanism as the installer):

   ```bash
   DOCKER_GID=<output of: stat -c %g /var/run/docker.sock>   # socket access for the qits user
   QITS_VARIANT=oauth
   TZ=Europe/Berlin
   # oauth variant — required, the container won't start without them:
   QUARKUS_OIDC_AUTH_SERVER_URL=https://keycloak.example.com/realms/myrealm
   QUARKUS_OIDC_CLIENT_ID=qits
   QUARKUS_OIDC_CREDENTIALS_SECRET=<client secret>
   QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING=true
   QUARKUS_HTTP_PROXY_ENABLE_FORWARDED_HOST=true
   ```

4. **Domains** tab: your domain → service `qits`, port `8080`, HTTPS on (Let's Encrypt) — Dokploy's
   Traefik terminates TLS and routes to qits over `dokploy-network`.
5. Deploy. The first build is the slow one (Maven + Angular inside the image build). Upgrading is
   just Redeploy (or a webhook/auto-deploy on push) — unlike the one-liner, the env persists in
   Dokploy. If a redeploy reuses the old image instead of rebuilding, check that the compose command
   Dokploy runs includes `--build` (plain `compose up` won't rebuild an existing `qits/app:latest`).

**Which variant under Dokploy?** `oauth` is the natural fit — Dokploy's Traefik is exactly the
"plain TLS reverse proxy" that variant expects, and Keycloak can run as another Dokploy service.
Choose `forwardauth` only if that same Traefik already has a forward-auth middleware (Authelia, …)
you can attach to the qits router via Dokploy's Traefik configuration, injecting
`Remote-User`/`Remote-Groups` and stripping client-supplied copies — without such a middleware a
forwardauth qits answers 401 to everything.

**Migrating from an installer deployment**: qits state lives in the compose project's `qits-data`
volume, and Dokploy's compose project name differs from the installer's — so copy the old
`qits_qits-data` volume's contents into the new project's volume before the first start (or start
fresh; the `qits_shared_*` volumes are external and carry over as-is).

See **[`docs/guides/deployment.md`](docs/guides/deployment.md)** for the full contract (the by-hand
equivalent, ingress/auth details incl. Keycloak client setup, config knobs, state & backups, upgrades).
