#!/usr/bin/env bash
# One-time coding-agent login. qits runs coding agents (Claude Code, Kimi Code) inside each
# per-workspace container; the agents read their credentials from a shared named volume mounted at
# /claude-home in every container. This script does the interactive login ONCE, writing the agent's
# config dir (~/.claude, ~/.kimi-code) onto that volume so every workspace container can
# authenticate without any credential at rest in the image or per-session env.
#
# Usage: agent-login.sh [claude|kimi]   (default: claude)
#
# Run it after building the image (docker build -t qits/workspace --target workspace -f
# docker/qits/Dockerfile .) and re-run it whenever you need to re-authenticate. It runs as your
# host uid so the credential files it writes are owned by the same uid the workspace containers
# run as.
#
# Config (must match the qits app):
#   QITS_WORKSPACE_IMAGE         default qits/workspace:latest   (qits.workspace.image)
#   QITS_CLAUDE_VOLUME           default qits_shared_dot_claude  (qits.workspace.claude-volume)
#   QITS_CLAUDE_MOUNT            default /claude-home            (qits.workspace.claude-mount)
set -euo pipefail

AGENT="${1:-claude}"
IMAGE="${QITS_WORKSPACE_IMAGE:-qits/workspace:latest}"
VOLUME="${QITS_CLAUDE_VOLUME:-qits_shared_dot_claude}"
MOUNT="${QITS_CLAUDE_MOUNT:-/claude-home}"

# Validate the agent up front, before any side effect: an unknown agent must fail without creating
# the volume (which also needs a running docker daemon just to print usage otherwise).
case "${AGENT}" in
  claude|kimi) ;;
  *) echo "usage: $0 [claude|kimi]" >&2; exit 64 ;;
esac

# Idempotent — the qits app also ensures this at startup, but create it here so a login can happen
# before the app has ever run.
docker volume create "${VOLUME}" >/dev/null

# Scaffolding shared by every agent login; per-agent env/command extras are appended at exec time.
# Runs as the host uid so the credential files land owned by the uid workspace containers run as.
RUN_ARGS=(-it --rm --user "$(id -u)" -e HOME="${MOUNT}" -v "${VOLUME}:${MOUNT}")

case "${AGENT}" in
  claude)
    echo "Logging in to Claude Code; credentials will be stored on the shared volume '${VOLUME}'."
    echo "Complete sign-in in the REPL onboarding (follow the printed URL, paste the code back), then exit."
    # Run the `claude` REPL, NOT `claude auth login`. The REPL's onboarding has an interactive
    # paste-the-code login that works over a TTY (-it); the `auth login` subcommand instead blocks
    # on a loopback callback the host browser can't reach and never prompts for a code. See the
    # resolved issue docs/issues/resolved/2026-07-05_claude-auth-login-terminal-no-input.md.
    exec docker run "${RUN_ARGS[@]}" "${IMAGE}" claude
    ;;
  kimi)
    echo "Logging in to Kimi Code; credentials will be stored on the shared volume '${VOLUME}'."
    echo "Open the printed verification URL in your browser and enter the user code; the CLI polls until done."
    # `kimi login` is a device-code flow (RFC 8628): it prints the verification URL + user code and
    # polls, so unlike `claude auth login` it works plainly over a TTY. KIMI_CODE_HOME points at the
    # volume's kimi dir — mirroring the KIMI_CODE_HOME env WorkspaceContainerFactory sets on every
    # workspace container — so the credentials land where every container reads them. This is the
    # REAL volume home, deliberately not a per-launch mktemp farm (see the kimi-code-harness feature
    # idea): an atomic-rename credential write must not strand the login in a throwaway dir.
    exec docker run "${RUN_ARGS[@]}" -e KIMI_CODE_HOME="${MOUNT}/.kimi-code" "${IMAGE}" kimi login
    ;;
esac
