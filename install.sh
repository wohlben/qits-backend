#!/usr/bin/env bash
# qits server install / deploy — LOCAL BUILD, no registry, no auto-update.
#
# Designed to run INSIDE a throwaway generic container that has the host docker socket mounted, so the
# whole clone+build happens in that container and the ONLY things left on the host afterwards are the
# two built images and the running qits stack (+ its named volumes). Nothing else leaks to the host.
# The canonical launch (from the server host — see docs/guides/deployment.md):
#
#   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock docker:cli sh -c '\
#     apk add --no-cache bash git curl >/dev/null && \
#     curl -fsSL https://raw.githubusercontent.com/wohlben/qits-backend/main/install.sh | bash'
#
# What it does (all against the HOST daemon via the mounted socket):
#   1. preflight  — docker CLI + compose + git present, docker socket reachable
#   2. clone      — git clone the repo (public; shallow, no submodules — the build doesn't need them)
#   3. workspace  — docker build the qits/workspace toolchain image (base of the app image + every ws)
#   4. app        — docker build the qits/app image (MULTI-STAGE: packages the fast-jar inside)
#   5. .env       — write DOCKER_GID (the socket's gid) + TZ
#   6. ensure     — create qits-net + the shared volumes if absent (they're `external` in compose)
#   7. up         — docker compose up -d
#   8. next steps — the optional agent login + the proxy/health reminders
#
# Re-running upgrades in place: it re-pulls the ref, rebuilds :latest, and recreates the container.
# Overridable via env: QITS_REPO, QITS_REF (branch/tag, default main), QITS_DIR (clone target).
set -euo pipefail

QITS_REPO="${QITS_REPO:-https://github.com/wohlben/qits-backend.git}"
QITS_REF="${QITS_REF:-main}"
QITS_DIR="${QITS_DIR:-/tmp/qits-src}"
COMPOSE_FILE="docker-compose.prod.yml"
APP_IMAGE="${QITS_IMAGE:-qits/app:latest}"
WORKSPACE_IMAGE="${QITS_WORKSPACE_IMAGE:-qits/workspace:latest}"

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

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

# --- 3. workspace image (toolchain; base of the app image AND every workspace container) --------
log "Building $WORKSPACE_IMAGE (toolchain — this is the slow one, Playwright + coding agent)"
docker build -t "$WORKSPACE_IMAGE" docker/workspace

# --- 4. app image (multi-stage: packages the fast-jar inside the build) -------------------------
log "Building $APP_IMAGE (multi-stage; runs the Maven + Angular build inside)"
docker build -t "$APP_IMAGE" -f docker/qits/Dockerfile .

# --- 5. .env -----------------------------------------------------------------------------------
log "Writing .env (DOCKER_GID + TZ)"
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
log "Done. qits is starting on the qits-net network (alias 'qits', port 8080)."
cat <<'EOF'

Next steps:
  - Front qits with your forward-auth proxy: put the proxy on qits-net and route it to
    http://qits:8080  (qits publishes no host port — do not expose 8080 unauthenticated).
  - Optional coding-agent login (one time):   bash docker/workspace/agent-login.sh
  - Watch it come up:                          docker compose -f docker-compose.prod.yml logs -f qits
  - Health (from inside the network):          curl -fsS http://qits:8080/q/health/ready

Upgrades are manual: re-run this installer (same launch command) — it re-pulls the ref, rebuilds the
images, and recreates the qits container. See docs/guides/deployment.md.
EOF
