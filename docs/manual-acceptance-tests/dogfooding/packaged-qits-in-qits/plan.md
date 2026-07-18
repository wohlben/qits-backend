# Packaged qits-in-qits: full local acceptance walk

## Introduction

The complete dogfooding experience on one machine, against the **packaged** app image (not
`quarkus:dev`): build and run qits as a container with no auth proxy in front, register qits'
own repository in it, launch the qits dev-server daemon in a workspace container, use the framed
qits UI through the web view, and verify telemetry from the child arrived in the parent.

This is the acceptance walk for
[qits dogfooding](../../../features/2026-07-18_qits-dogfooding-managed-app-convention.md); the
registration details it applies come from
[qits-in-qits-registration](../../../guides/qits-in-qits-registration.md) and the packaged-run
mechanics from [deployment](../../../guides/deployment.md). Sister document:
[`compose.local-port.yml`](compose.local-port.yml) (loopback port publish overlay).

**Auth model of this walk ("without auth"):** the image is built with the `forwardauth` variant
and run with **no proxy** — qits then trusts any client-supplied `Remote-User` header (that trust
boundary is the variant's whole design, and the prod fallback identity is LaunchMode-guarded off).
"Logging in" is therefore: send `Remote-User: tester` yourself on every request. The overlay binds
**127.0.0.1 only**; never expose this container beyond loopback (it grants git push, MCP, and —
via the socket — the host docker daemon).

## Preconditions

- Docker on the host; a checkout of `qits-backend` (submodules NOT required for the image builds).
- Network reach to GitHub (the child's clone imports the fixture submodules, and its webui build
  fetches the `@qits/angular` git dependency).
- ~15 min for a cold image build; the child's first in-container build is similarly heavy. Budget
  ≥ 8 GB free RAM (parent JVM + child Maven/Quarkus/ng).
- If a dev/devcontainer qits already runs on `qits-net` claiming the `qits` alias, this walk's
  `.env` picks the distinct alias `qits-mat` — two stacks answering the same alias round-robin
  each other's container→qits traffic.

## Steps

### 1. Build both images

```bash
docker build -t qits/workspace:latest --target workspace -f docker/qits/Dockerfile .
docker build -t qits/app:latest --build-arg QITS_VARIANT=forwardauth -f docker/qits/Dockerfile .
```

*Expect:* both builds succeed; `docker image ls qits/app qits/workspace` shows fresh `latest` tags.

### 2. Environment + external resources

```bash
cat > .env <<EOF
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
TZ=$(cat /etc/timezone 2>/dev/null || echo Etc/UTC)
QITS_WORKSPACE_GIT_HOST=qits-mat
EOF
docker network inspect qits-net >/dev/null 2>&1 || docker network create qits-net
for v in qits_shared_dot_claude qits_shared_m2 qits_shared_pnpm; do
  docker volume inspect "$v" >/dev/null 2>&1 || docker volume create "$v"; done
```

*Expect:* no errors (all creates are idempotent).

### 3. Up, with the loopback port overlay

```bash
docker compose -f docker-compose.prod.yml \
  -f docs/manual-acceptance-tests/dogfooding/packaged-qits-in-qits/compose.local-port.yml up -d
until curl -fsS http://127.0.0.1:18080/q/health/ready >/dev/null; do sleep 3; done && echo READY
```

*Expect:* `READY` within ~60 s; `docker compose -f docker-compose.prod.yml ps` shows the service
healthy.

### 4. Auth wall sanity

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/api/projects        # no header
curl -s -H 'Remote-User: tester' http://127.0.0.1:18080/api/auth/me                  # with header
```

*Expect:* `401` without the header; `{"variant":"forwardauth","username":"tester"}` with it.

### 5. Browser session with the identity header

Human: install a header-injection extension (e.g. ModHeader), add `Remote-User: tester`, open
`http://127.0.0.1:18080/`. Agent:

```bash
npx -y agent-browser open about:blank
npx -y agent-browser set headers '{"Remote-User":"tester"}'
npx -y agent-browser open http://127.0.0.1:18080/
```

*Expect:* the qits UI renders (Projects/Commands/Feature Flows navigation), no login wall, no
console errors. The packaged SPA is served by Quarkus itself (no `:4200` involved).

### 6. Register qits as a project + repository

UI: *Projects → New project* → name `qits`. Then *Add repository*:

- URL `https://github.com/wohlben/qits-backend.git`, archetype `SERVICE`,
  **import submodules: ON** (without it the child build hard-fails in
  `derive-fixture-bares.sh`).

Then on the repository detail page run **import submodules** once more (imports the
quarkus-angular fixture's nested `webui` gitlink).

*Expect:* the repository appears with a `main` workspace; the submodule import lists
`testing-repo`, `qits-fixture-angular`, `testing-repo-quarkus-angular` as sibling repositories,
and the second pass adds the nested edge.

### 7. Create and start the qits dev-server daemon

Create the daemon exactly per
[the registration guide](../../../guides/qits-in-qits-registration.md) — in short: name
`qits dev server`; otel **on**; web view port **8080**, entryPath `projects`; ready pattern
`(?i)Listening on: http`; the start script:

```bash
./mvnw -q -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true \
  -Dqits.variant=forwardauth -Dquarkus.http.host=0.0.0.0 -Dquarkus.http.port=8080 \
  -Dquarkus.http.root-path="${QITS_PUBLIC_BASE:-/}" \
  -Dquarkus.otel.sdk.disabled=false \
  -Dquarkus.otel.exporter.otlp.endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-http://localhost:4317}" \
  -Dqits.speech.warmup-on-start=false
```

plus the LOG_LEVEL + PATTERN observers, the `service/quarkus.log` FILE source, and the two health
checks from the guide. Start it on the `main` workspace (Daemons panel → start).

*Expect:* first launch takes long (full in-container reactor + pnpm build; watch the daemon log).
Status reaches `READY`; both health dots eventually green.

### 8. Use the framed qits UI

Open the workspace's **Web view**.

*Expect:* the child qits UI renders inside the frame under `/daemon/{ws}/{daemonId}/` (child
forwardauth dev mode answers as user `dev`). Navigate: Projects loads (empty child), open pages,
confirm no console errors and that all frame requests stay under the `/daemon/...` prefix.

### 9. Verify telemetry reached the parent

Interact in the frame for a few clicks, wait ~5 s, then in the **parent** UI open the workspace's
*Telemetry* tab — or probe the API:

```bash
REPO=<repoId>   # from the parent UI/API
curl -s -H 'Remote-User: tester' \
  "http://127.0.0.1:18080/api/repositories/$REPO/workspaces/main/telemetry/slow-spans?thresholdMs=0" \
  | python3 -m json.tool | grep -E 'serviceName|"name"' | sort -u | head
```

*Expect:*

- spans from **`qits dev server-browser`** (the child SPA: `documentLoad`, fetch/`resourceFetch`,
  navigations) — the browser half of the relay;
- spans from the child **backend** (Quarkus server spans, service name from its artifact);
- **no** spans for `/otel/v1/*`, `/daemon/*`, `/git/*`, `/mcp/*` (the suppress list);
- the *Logs* view shows the child's log records (severity-classified).

### 10. Capture round-trip (optional but recommended)

In the framed child UI, click the floaty **Capture this page into qits** button, pick an element.

*Expect:* a new `feature/<timestamp>` workspace appears in the **parent** whose goal carries the
child-UI snapshot including the `promptContext` state entry.

## Acceptance checklist

- [ ] Both images build from a plain checkout (no submodules).
- [ ] Packaged container healthy on loopback; `401` without `Remote-User`, identity echoed with it.
- [ ] qits-backend registered with two-level submodule import; workspace container materializes.
- [ ] Daemon reaches `READY`; health dots green.
- [ ] Framed child UI usable through the web view, all requests under the proxy prefix.
- [ ] Parent telemetry shows child browser **and** backend spans + logs; suppressed paths absent.
- [ ] (Optional) Capture from the frame creates a parent workspace with `promptContext` state.

## Cleanup

```bash
docker compose -f docker-compose.prod.yml down          # stops qits; workspace containers are
docker ps --filter name=qits-ws- -q | xargs -r docker rm -f   # siblings — remove them explicitly
# State that persists on purpose: the qits-data volume (H2 + origins) and the qits_shared_* caches.
# Full reset: docker volume rm qits_qits-data
```

## Troubleshooting

- **Child build fails immediately with a fixture-bares error** → the repository was registered
  without submodule import; re-register with the toggle on (the import is one-time).
- **Workspace container can't reach the parent (git clone 404 / OTLP dark)** → alias collision:
  another stack on `qits-net` also answers your `QITS_WORKSPACE_GIT_HOST` alias. Pick a unique
  one in `.env` and recreate.
- **Daemon READY but the frame shows the splash forever** → the web-view port was added after the
  container existed; recreate (stop-container → ensure-container → start).
- **`pnpm install` fails in the child** → no GitHub reachability from workspace containers (the
  `@qits/angular` git dependency needs it).
