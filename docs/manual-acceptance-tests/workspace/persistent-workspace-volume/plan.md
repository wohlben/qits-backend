# Persistent `/workspace` volume

Verifies [persistent `/workspace` volume](../../../epics/qits-workspaces/features/2026-07-25_persistent-workspace-volume.md):
a workspace's checkout is a named Docker volume that survives container recreation, is removed on
delete/discard, and is reaped by the startup GC when orphaned.

## Preconditions

- A packaged qits deployed per the [packaged qits-in-qits walk](../../dogfooding/packaged-qits-in-qits/plan.md)
  (reachable at `http://127.0.0.1:18080`, `Remote-User: tester`) with ≥1 registered repository, and
  host `docker` access to the engine qits uses.
- `qits.workspace.persist-workspace=true` (the default).
- `docker`, `curl`, `jq`. ~10 min.

```bash
Q=http://127.0.0.1:18080 ; H='Remote-User: tester'
PROJECT=$(curl -s -H "$H" $Q/api/projects | jq -r '.entries[0].project.id')
REPO_JSON=$(curl -s -H "$H" $Q/api/projects/$PROJECT/repositories | jq -r '.entries[0].repository')
REPO=$(echo "$REPO_JSON" | jq -r '.id') ; MAIN=$(echo "$REPO_JSON" | jq -r '.mainBranch')
WS=vol-accept ; VOLUME=qits_workspace_$WS
```

## Steps

### 1. Provisioning creates the labeled volume

```bash
curl -s -H "$H" -H 'Content-Type: application/json' \
  -d "{\"id\":\"$WS\",\"branch\":\"$WS\",\"parent\":\"$MAIN\",\"preamble\":null}" \
  $Q/api/repositories/$REPO/workspaces >/dev/null
curl -s -H "$H" -X POST $Q/api/repositories/$REPO/workspaces/$WS/ensure-container >/dev/null
until docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}' | grep -q .; do sleep 2; done
CONTAINER=$(docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}')
docker volume inspect "$VOLUME" --format '{{json .Labels}}' | jq .
```

*Expect:* `docker volume inspect $VOLUME` succeeds; labels include `qits.managed=workspace-volume`,
`qits.workspace=vol-accept`, `qits.repository=$REPO`, `qits.branch=vol-accept`, `qits.project=<id>`.

### 2. An uncommitted change survives container recreation

Write an **uncommitted** marker (so its survival can only be the volume, never a push), then remove
the container and Start again:

```bash
docker exec "$CONTAINER" sh -lc 'echo marker > /workspace/VOLUME-MARKER.txt'
docker rm -f "$CONTAINER"
docker volume ls --filter label=qits.managed=workspace-volume --format '{{.Name}}' | grep "$VOLUME"   # kept
curl -s -H "$H" -X POST $Q/api/repositories/$REPO/workspaces/$WS/ensure-container >/dev/null
until docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}' | grep -q .; do sleep 2; done
CONTAINER=$(docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}')
docker exec "$CONTAINER" cat /workspace/VOLUME-MARKER.txt
```

*Expect:* `$VOLUME` still listed after `docker rm`; the last command prints `marker`.

### 3. Delete-container removes the volume; Start re-clones fresh

Trigger via the UI (Shift on the workspace's **Start** button → **Delete**, retype the branch name),
or the API:

```bash
curl -s -H "$H" -X POST $Q/api/repositories/$REPO/workspaces/$WS/delete-container >/dev/null
docker volume ls --filter label=qits.managed=workspace-volume --format '{{.Name}}' | grep "$VOLUME" || echo GONE
curl -s -H "$H" -X POST $Q/api/repositories/$REPO/workspaces/$WS/ensure-container >/dev/null
until docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}' | grep -q .; do sleep 2; done
CONTAINER=$(docker ps --filter "label=qits.workspace=$WS" --format '{{.Names}}')
docker exec "$CONTAINER" sh -lc 'test -e /workspace/VOLUME-MARKER.txt && echo STILL-THERE || echo MARKER-GONE'
```

*Expect:* `GONE` (volume removed by delete), then `MARKER-GONE` (Start re-cloned into a fresh volume).

### 4. Startup GC reaps a dangling volume, spares a live one

```bash
GID=ghost-$(date +%s) ; GHOST=qits_workspace_$GID
docker volume create --label qits.managed=workspace-volume --label qits.repository="$REPO" \
  --label qits.workspace="$GID" "$GHOST" >/dev/null
docker compose -f docker-compose.prod.yml restart <qits-service-name>
until curl -fsS $Q/q/health/ready >/dev/null; do sleep 3; done
docker volume ls --filter label=qits.managed=workspace-volume --format '{{.Name}}' | grep "$GHOST" || echo GHOST-REAPED
docker volume ls --filter label=qits.managed=workspace-volume --format '{{.Name}}' | grep "$VOLUME" && echo LIVE-SPARED
```

*Expect:* `GHOST-REAPED` (orphan gone) and `LIVE-SPARED` (`$VOLUME` kept — it has an ACTIVE row). The
qits startup log contains `Reaping dangling workspace volume qits_workspace_ghost-…`.

### 5. Discard removes the volume

```bash
curl -s -H "$H" -H 'Content-Type: application/json' -d '{"result":null}' \
  -X POST $Q/api/repositories/$REPO/workspaces/$WS/discard >/dev/null
docker volume ls --filter label=qits.managed=workspace-volume --format '{{.Name}}' | grep "$VOLUME" || echo DISCARD-GONE
```

*Expect:* `DISCARD-GONE`.

## Acceptance checklist

- [ ] §1 provisioning creates `qits_workspace_<workspaceId>` with the full `qits.*` label set.
- [ ] §2 the volume is kept across `docker rm` and the uncommitted marker survives Start.
- [ ] §3 delete-container removes the volume; the next Start re-clones fresh (marker gone).
- [ ] §4 the startup GC reaps a dangling managed volume (logged) and spares the live one.
- [ ] §5 discard removes the volume.

## Cleanup

```bash
docker rm -f "$CONTAINER" 2>/dev/null; docker volume rm -f "$VOLUME" "$GHOST" 2>/dev/null; true
```

(The deployed qits stack, its repository, and the `qits_shared_*` caches persist.)
