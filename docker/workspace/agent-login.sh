#!/usr/bin/env bash
# One-time coding-agent login. qits runs the coding agent (Claude Code) inside each per-worktree
# container; the agent reads its credentials from a shared named volume mounted at /claude-home
# (HOME) in every container. This script does the interactive OAuth login ONCE, writing ~/.claude
# onto that volume so every worktree container can authenticate without any credential at rest in
# the image or per-session env.
#
# Run it after building the image (docker build -t qits/workspace docker/workspace) and re-run it
# whenever you need to re-authenticate. It runs as your host uid so the credential files it writes
# are owned by the same uid the worktree containers run as.
#
# Config (must match the qits app):
#   QITS_WORKSPACE_IMAGE         default qits/workspace:latest   (qits.workspace.image)
#   QITS_CLAUDE_VOLUME           default qits_shared_dot_claude  (qits.workspace.claude-volume)
#   QITS_CLAUDE_MOUNT            default /claude-home            (qits.workspace.claude-mount)
#
# Any extra arguments are passed through to `claude auth login`, e.g.:
#   ./agent-login.sh --console          # Anthropic Console (API-usage billing) instead of subscription
#   ./agent-login.sh --email you@x.dev  # pre-fill the email on the login page
set -euo pipefail

IMAGE="${QITS_WORKSPACE_IMAGE:-qits/workspace:latest}"
VOLUME="${QITS_CLAUDE_VOLUME:-qits_shared_dot_claude}"
MOUNT="${QITS_CLAUDE_MOUNT:-/claude-home}"

# Idempotent — the qits app also ensures this at startup, but create it here so a login can happen
# before the app has ever run.
docker volume create "${VOLUME}" >/dev/null

echo "Logging in to Claude Code; credentials will be stored on the shared volume '${VOLUME}'."
echo "Follow the printed URL to complete the OAuth flow, then paste the code back here."
# `claude auth login` is the CLI sign-in (default: Claude subscription; pass --console for API
# billing). It needs a TTY (-it); no browser in the container, so it prints a URL + prompts for the
# code you paste back. Default to --claudeai unless the caller passes their own auth flags.
if [ "$#" -eq 0 ]; then
  set -- --claudeai
fi
exec docker run -it --rm \
  --user "$(id -u)" \
  -e HOME="${MOUNT}" \
  -v "${VOLUME}:${MOUNT}" \
  "${IMAGE}" \
  claude auth login "$@"
