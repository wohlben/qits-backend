#!/usr/bin/env bash
# qits server install / bootstrap. Copy-paste this onto a bare Linux server (no repo checkout needed)
# and run it — it fetches the compose file from GitHub and brings the production stack up. Idempotent:
# safe to re-run; it re-fetches assets, upserts .env, and re-applies the stack.
#
#   ./install.sh                # pull-based: fetch compose + pull images from GHCR, then up
#   ./install.sh --build        # build images locally instead (needs a full repo checkout, not curl)
#
# What it does (the "remaining commands" from docs/guides/deployment.md, in order):
#   1. preflight   — docker + compose + curl present, docker socket reachable
#   2. fetch       — curl docker-compose.prod.yml (+ the optional agent-login.sh) from raw GitHub
#   3. images      — pull the qits app + workspace images from GHCR (or build locally with --build)
#   4. .env        — write DOCKER_GID (the docker socket's gid) and TZ
#   5. up          — docker compose up -d (creates qits-net + shared volumes on first run)
#   6. next steps  — the optional agent login + the proxy/health reminders
#
# Overridable via env: QITS_REF (branch/tag, default main), QITS_RAW_BASE, QITS_IMAGE,
# QITS_WORKSPACE_IMAGE.
set -euo pipefail

cd "$(dirname "$0")"

QITS_REF="${QITS_REF:-main}"
QITS_RAW_BASE="${QITS_RAW_BASE:-https://raw.githubusercontent.com/wohlben/qits/${QITS_REF}}"
COMPOSE_FILE="docker-compose.prod.yml"
APP_IMAGE="${QITS_IMAGE:-ghcr.io/wohlben/qits:latest}"
WORKSPACE_IMAGE="${QITS_WORKSPACE_IMAGE:-ghcr.io/wohlben/qits-workspace:latest}"
BUILD=false
[ "${1:-}" = "--build" ] && BUILD=true

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Fetch a repo-relative path from raw GitHub into the same relative path here (skip if already
# present, e.g. when run from a real checkout). Private repo? export QITS_RAW_BASE with a token URL.
fetch() {
  local path="$1"
  [ -f "$path" ] && { log "Using existing $path"; return; }
  log "Fetching $path"
  mkdir -p "$(dirname "$path")"
  curl -fsSL "${QITS_RAW_BASE}/${path}" -o "$path" \
    || die "Could not fetch ${QITS_RAW_BASE}/${path} (check QITS_REF / network / repo visibility)."
}

# --- 1. preflight ------------------------------------------------------------------------------
log "Preflight: checking docker + compose + curl"
command -v curl  >/dev/null 2>&1 || die "curl not found. Install curl first."
command -v docker >/dev/null 2>&1 || die "docker CLI not found. Install Docker Engine first."
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "Docker Compose not found. Install the compose plugin (docker compose) or docker-compose."
fi
[ -S /var/run/docker.sock ] || die "/var/run/docker.sock not found — is the docker daemon running?"

# --- 2. fetch ----------------------------------------------------------------------------------
if $BUILD; then
  # Local build needs the whole repo (Dockerfiles, source, mvnw) — curl can't reconstruct that.
  [ -f "$COMPOSE_FILE" ] && [ -x ./mvnw ] \
    || die "--build must run from a full repo checkout (git clone), not the curl bootstrap."
else
  fetch "$COMPOSE_FILE"
  # Best-effort (NOT via fetch(), whose die() would abort): the optional coding-agent login script,
  # so step 6 works without a checkout. A miss is fine — the agent login is optional.
  if [ ! -f docker/workspace/agent-login.sh ]; then
    mkdir -p docker/workspace
    curl -fsSL "${QITS_RAW_BASE}/docker/workspace/agent-login.sh" \
      -o docker/workspace/agent-login.sh 2>/dev/null \
      && log "Fetched docker/workspace/agent-login.sh" \
      || log "Skipped agent-login.sh (optional; fetch it later if you use the coding agent)."
  fi
fi

# --- 3. images ---------------------------------------------------------------------------------
if $BUILD; then
  log "Building images locally (--build)"
  docker build -t qits/workspace:latest -t "$WORKSPACE_IMAGE" docker/workspace
  ./mvnw -pl service -am package -DskipTests -Dqits.dev-guard.skip=true
  docker build -t "$APP_IMAGE" -f docker/qits/Dockerfile .
else
  log "Pulling images from GHCR"
  # The workspace image is not a compose service, so pull it explicitly; the qits image comes via up.
  docker pull "$WORKSPACE_IMAGE" || die \
    "Could not pull $WORKSPACE_IMAGE. If the package is private, run: docker login ghcr.io  (or re-run with --build)."
  docker pull "$APP_IMAGE" || die \
    "Could not pull $APP_IMAGE. If the package is private, run: docker login ghcr.io  (or re-run with --build)."
fi

# --- 4. .env -----------------------------------------------------------------------------------
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

# --- 5. up -------------------------------------------------------------------------------------
log "Starting the stack (creates qits-net + shared volumes on first run)"
$COMPOSE -f "$COMPOSE_FILE" up -d

# --- 6. next steps -----------------------------------------------------------------------------
log "Done. qits is starting on the qits-net network (alias 'qits', port 8080)."
cat <<'EOF'

Next steps:
  - Front qits with your forward-auth proxy: put the proxy on qits-net and route it to
    http://qits:8080  (qits publishes no host port — do not expose 8080 unauthenticated).
  - Optional coding-agent login (one time):   bash docker/workspace/agent-login.sh
  - Watch it come up:                          docker compose -f docker-compose.prod.yml logs -f qits
  - Health (from inside the network):          curl -fsS http://qits:8080/q/health/ready

Continuous deployment is now live: the watchtower container polls GHCR and auto-updates qits when CI
pushes a new image. See docs/guides/deployment.md.
EOF
