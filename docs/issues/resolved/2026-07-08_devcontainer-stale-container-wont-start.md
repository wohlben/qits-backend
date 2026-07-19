# Devcontainer won't come up — stale container with a dead VS Code socket mount

## Introduction

Hit while trying to bring the qits devcontainer up (VS Code "Reopen in Container" /
`devcontainer up`). Not a defect in our config — an interaction between the devcontainer CLI's
`--no-recreate` reuse and VS Code's ephemeral, per-session GUI socket mounts on Docker Desktop / WSL2.
Related: [qits-net devcontainer unification](../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md),
[.devcontainer/docker-compose.yml](../../.devcontainer/docker-compose.yml).

## Symptom

`devcontainer up` (and VS Code "Reopen in Container") fails at the compose-up step. The CLI swallows the
underlying error and only prints:

```
Error: Command failed: docker compose --project-name qits_devcontainer ... up -d --no-recreate
{"outcome":"error","description":"An error occurred starting Docker Compose up.", ...}
```

Running that compose command by hand shows the real cause:

```
Error response from daemon: failed to create task for container: ... runc create failed:
unable to start container process: error during container init: error mounting
".../docker-desktop-bind-mounts/.../<hash>" to rootfs at "/tmp/vscode-wayland-<uuid>.sock":
... not a directory: Are you trying to mount a directory onto a file (or vice-versa)?
```

## Cause

A **stale container from a previous VS Code session** was left `Exited` (e.g. after a host reboot /
Docker Desktop restart). VS Code injects ephemeral GUI-forwarding bind mounts into the container it
creates — a Wayland/X11 socket at `/tmp/vscode-wayland-<uuid>.sock` sourced from a per-session path
under `/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/...`. That source socket only exists for
the session that created it; once the session ends it's gone.

`devcontainer up` runs `docker compose up -d --no-recreate`, so it tries to **restart the existing
stale container** rather than create a fresh one. runc can't recreate the dead socket bind mount, so
container init fails and the whole bring-up aborts.

Confirm on the stale container with:

```bash
docker inspect qits_devcontainer-qits-1 \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' | grep wayland
```

## Fix / recovery

Remove the stale container so the next bring-up creates a fresh one (all persistent state lives in
bind mounts / named volumes — `qits-data`, the shared `qits_shared_*` volumes, and the `/workspace`
host bind — so removing the container itself loses nothing):

```bash
docker rm -f qits_devcontainer-qits-1     # VS Code / devcontainer CLI project name
docker rm -f devcontainer-qits-1          # plain `docker compose` project name, if present
```

Then "Reopen in Container" / `devcontainer up` again — it recreates fresh and succeeds. (First
create re-runs the long `postCreateCommand` build+seed; that's expected on a fresh container.)

## Why not auto-remove in initializeCommand

Tempting to have `initializeCommand` always `docker rm -f` the container, but that would force a
**recreate on every open**, which re-runs the ~10-min `postCreateCommand` (full reactor build +
`seed`/`seed-webapp`) each time — defeating the CLI's fast reuse. Precisely detecting "stale and
unstartable" up front is awkward, so the pragmatic contract is: normal reuse stays fast, and on the
rare stale-mount failure you run the one-liner above. Left as-is deliberately.
