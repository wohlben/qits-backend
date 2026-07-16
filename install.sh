#!/usr/bin/env bash
# qits server install / deploy — LOCAL BUILD, no registry, no auto-update.
#
# Designed to run INSIDE a throwaway generic container that has the host docker socket mounted, so the
# whole clone+build happens in that container and the ONLY things left on the host afterwards are the
# two built images and the running qits stack (+ its named volumes). Nothing else leaks to the host.
# The canonical launch (from the server host — see docs/guides/deployment.md):
#
#   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
#     -e QITS_VARIANT=forwardauth docker:cli sh -c '\
#     apk add --no-cache bash git curl >/dev/null && \
#     curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
#
# What it does (all against the HOST daemon via the mounted socket):
#   1. preflight  — docker CLI + compose + git present, docker socket reachable
#   2. clone      — git clone the repo (public; shallow, no submodules — the build doesn't need them)
#   3. workspace  — docker build the qits/workspace toolchain image (base of the app image + every ws)
#   4. app        — docker build the qits/app image (MULTI-STAGE: packages the fast-jar inside)
#   5. .env       — write DOCKER_GID (the socket's gid) + TZ + any provided auth env (QUARKUS_OIDC_*,
#                   QITS_AUTH_*, QUARKUS_HTTP_PROXY_*), loaded into the container via compose env_file
#   6. ensure     — create qits-net + the shared volumes if absent (they're `external` in compose)
#   7. up         — docker compose up -d
#   8. next steps — the optional agent login + the proxy/health reminders
#
# Re-running upgrades in place: it re-pulls the ref, rebuilds :latest, and recreates the container.
# REQUIRED env: QITS_VARIANT — the auth build variant (forwardauth | oauth), baked into the app image
# at build time (docs/features/2026-07-16_build-variant-auth.md); there is no runtime toggle.
# Overridable via env: QITS_REPO, QITS_REF (branch/tag, default main), QITS_DIR (clone target).
set -euo pipefail

QITS_REPO="${QITS_REPO:-https://github.com/wohlben/qits-backend.git}"
QITS_REF="${QITS_REF:-main}"
QITS_DIR="${QITS_DIR:-/tmp/qits-src}"
QITS_VARIANT="${QITS_VARIANT:-}"
COMPOSE_FILE="docker-compose.prod.yml"
APP_IMAGE="${QITS_IMAGE:-qits/app:latest}"
WORKSPACE_IMAGE="${QITS_WORKSPACE_IMAGE:-qits/workspace:latest}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Every qits build names its auth variant explicitly — an image is either forward-auth-proxied or
# OIDC, decided here, never at runtime.
case "$QITS_VARIANT" in
  forwardauth|oauth) ;;
  *) die "Set QITS_VARIANT to the auth build variant:
  QITS_VARIANT=forwardauth   qits trusts the identity headers your forward-auth proxy injects
                             (Remote-User/Remote-Groups; the proxy must strip client-supplied copies)
  QITS_VARIANT=oauth         qits does OIDC login itself (Keycloak); the container then REQUIRES
                             QUARKUS_OIDC_AUTH_SERVER_URL / _CLIENT_ID / _CREDENTIALS_SECRET env
See docs/guides/deployment.md." ;;
esac

# --- 1. preflight ------------------------------------------------------------------------------
log "Preflight: docker + compose + git"
command -v docker >/dev/null 2>&1 || die "docker CLI not found (the launch container needs it)."
command -v git    >/dev/null 2>&1 || die "git not found. In the launch container: apk add git (or apt-get install -y git)."
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not found. Install the compose plugin (docker compose) or docker-compose."
fi
docker version >/dev/null 2>&1 || die "Cannot reach the docker daemon. Mount /var/run/docker.sock into this container."

# --- 2. clone (or reuse a checkout we're already sitting in) -----------------------------------
# If we're already inside a repo checkout (compose file + mvnw present), build from here. Otherwise
# clone: public repo, shallow, NO submodules — the app image build skips tests + the fixture derive,
# so the git submodules under domain/src/test/resources/fixtures are never needed.
if [ -f "$COMPOSE_FILE" ] && [ -x ./mvnw ]; then
  log "Using the current checkout ($(pwd))"
else
  if [ -d "$QITS_DIR/.git" ]; then
    log "Refreshing existing clone at $QITS_DIR ($QITS_REF)"
    git -C "$QITS_DIR" fetch --depth 1 origin "$QITS_REF"
    git -C "$QITS_DIR" checkout -q FETCH_HEAD
  else
    log "Cloning $QITS_REPO ($QITS_REF) into $QITS_DIR"
    git clone --depth 1 --branch "$QITS_REF" "$QITS_REPO" "$QITS_DIR" \
      || die "Clone failed. Is $QITS_REPO reachable/public, and is $QITS_REF a valid branch/tag?"
  fi
  cd "$QITS_DIR"
fi

# --- 2.5 deployment env for the variant ---------------------------------------------------------
# The one-liner flow leaves NO checkout on the host — this throwaway container (compose file, .env)
# vanishes on --rm. So deployment-specific auth env cannot be "edited into the compose file later";
# it flows THROUGH this installer: pass the vars below with -e on the docker run, and step 5 writes
# the provided ones into .env, which the compose service loads via env_file. Re-runs (upgrades) must
# pass them again. (Alternative: keep a persistent checkout on the host and run install.sh from it —
# then .env survives and re-runs pick it up automatically.)
AUTH_ENV_VARS="QUARKUS_OIDC_AUTH_SERVER_URL QUARKUS_OIDC_CLIENT_ID QUARKUS_OIDC_CREDENTIALS_SECRET \
QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING QUARKUS_HTTP_PROXY_ENABLE_FORWARDED_HOST \
QITS_AUTH_REQUIRED_ROLE QITS_AUTH_FORWARD_USER_HEADER QITS_AUTH_FORWARD_GROUPS_HEADER"

# The oauth image refuses to start without its OIDC config (intended fail-fast) — catch that here,
# BEFORE the slow builds. A var counts as provided if it's in this process env or already in a
# pre-existing .env (the persistent-checkout flow).
if [ "$QITS_VARIANT" = oauth ]; then
  for v in QUARKUS_OIDC_AUTH_SERVER_URL QUARKUS_OIDC_CLIENT_ID QUARKUS_OIDC_CREDENTIALS_SECRET; do
    if [ -z "${!v:-}" ] && ! grep -q "^${v}=" .env 2>/dev/null; then
      die "QITS_VARIANT=oauth needs the OIDC config or the container won't start. Pass it into the
installer (docker run -e), e.g.:
  -e QUARKUS_OIDC_AUTH_SERVER_URL=https://keycloak.example.com/realms/myrealm \\
  -e QUARKUS_OIDC_CLIENT_ID=qits \\
  -e QUARKUS_OIDC_CREDENTIALS_SECRET=<client secret>
(behind a TLS proxy also: -e QUARKUS_HTTP_PROXY_PROXY_ADDRESS_FORWARDING=true \\
                          -e QUARKUS_HTTP_PROXY_ENABLE_FORWARDED_HOST=true)
Missing: $v. See docs/guides/deployment.md."
    fi
  done
fi

# --- 3. workspace image (toolchain; the image every workspace container runs) -------------------
# The `workspace` stage of the single docker/qits/Dockerfile. The app image build below is
# self-contained (same file, in-file stages), so this tag is purely the RUNTIME image qits spawns
# workspace containers from.
log "Building $WORKSPACE_IMAGE (toolchain — this is the slow one, Playwright + coding agent)"
docker build -t "$WORKSPACE_IMAGE" --target workspace -f docker/qits/Dockerfile .

# --- 4. app image (multi-stage: packages the fast-jar inside the build) -------------------------
log "Building $APP_IMAGE (multi-stage; runs the Maven + Angular build inside; variant: $QITS_VARIANT)"
docker build -t "$APP_IMAGE" --build-arg QITS_VARIANT="$QITS_VARIANT" -f docker/qits/Dockerfile .

# --- 5. .env -----------------------------------------------------------------------------------
log "Writing .env (DOCKER_GID + TZ + provided auth env)"
docker_gid="$(stat -c %g /var/run/docker.sock)"
tz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || echo Etc/UTC)"
upsert() { # upsert KEY VALUE into .env without clobbering other keys
  local key="$1" val="$2"
  touch .env
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}
upsert DOCKER_GID "$docker_gid"
upsert TZ "$tz"
# Deployment-specific auth env (step 2.5): only the vars actually provided land in .env, so absent
# ones stay truly unset in the container (env_file semantics) and the image defaults apply.
for v in $AUTH_ENV_VARS; do
  [ -n "${!v:-}" ] && upsert "$v" "${!v}"
done

# --- 6. ensure the shared network + volumes ----------------------------------------------------
# Declared `external` in the compose file, so they must exist before `up`. Create-if-absent, exactly
# how qits' own startup (ensureNetwork/ensureVolume) and the DockerExecutor manage them — idempotent,
# and it means the stack comes up cleanly whether or not qits-net already exists (fresh server, a
# prior qits run, or a devcontainer that made it first). No "network not created by compose" refusal.
log "Ensuring qits-net + shared volumes exist (idempotent)"
docker network inspect qits-net >/dev/null 2>&1 || docker network create qits-net >/dev/null
for v in qits_shared_dot_claude qits_shared_m2 qits_shared_pnpm; do
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v" >/dev/null
done

# --- 7. up -------------------------------------------------------------------------------------
log "Starting the stack"
$COMPOSE -f "$COMPOSE_FILE" up -d

# --- 8. next steps -----------------------------------------------------------------------------
log "Done. qits ($QITS_VARIANT variant) is starting on the qits-net network (alias 'qits', port 8080)."
if [ "$QITS_VARIANT" = "forwardauth" ]; then
  cat <<'EOF'

Next steps (forwardauth variant):
  - Front qits with your forward-auth proxy: put the proxy on qits-net and route it to
    http://qits:8080 (qits publishes no host port). qits 401s EVERY UI/API request until the proxy
    injects the authenticated user header (Remote-User; groups in Remote-Groups) — and the proxy
    MUST strip client-supplied copies of those headers, since qits trusts them unconditionally.
    Different header names (e.g. oauth2-proxy's X-Auth-Request-*)? Set QITS_AUTH_FORWARD_USER_HEADER /
    QITS_AUTH_FORWARD_GROUPS_HEADER in docker-compose.prod.yml.
  - Optional coding-agent login (one time):   bash docker/workspace/agent-login.sh
  - Watch it come up:                          docker compose -f docker-compose.prod.yml logs -f qits
  - Health (from inside the network):          curl -fsS http://qits:8080/q/health/ready

Upgrades are manual: re-run this installer (same launch command) — it re-pulls the ref, rebuilds the
images, and recreates the qits container. See docs/guides/deployment.md.
EOF
else
  cat <<'EOF'

Next steps (oauth variant):
  - The OIDC env you passed into this installer is in the stack's .env (loaded via env_file) — the
    container starts with it baked in. On upgrades, pass the SAME -e variables again: the one-liner
    flow keeps nothing on the host, so the installer invocation is the configuration.
  - Route your TLS reverse proxy on qits-net to http://qits:8080 (qits publishes no host port).
  - Keycloak: confidential client, Standard flow, redirect URIs https://<public-host>/* — see
    docs/guides/deployment.md.
  - Optional coding-agent login (one time):   bash docker/workspace/agent-login.sh
  - Watch it come up:                          docker compose -f docker-compose.prod.yml logs -f qits
  - Health (from inside the network):          curl -fsS http://qits:8080/q/health/ready

Upgrades are manual: re-run this installer (same launch command) — it re-pulls the ref, rebuilds the
images, and recreates the qits container. See docs/guides/deployment.md.
EOF
fi
