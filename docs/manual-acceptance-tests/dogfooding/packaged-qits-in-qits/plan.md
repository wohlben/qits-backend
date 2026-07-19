# Packaged qits-in-qits: full local acceptance walk

## Introduction

The complete dogfooding experience on one machine, against the **packaged** app image (not
`quarkus:dev`): build and run qits as a container with no auth proxy in front, register qits'
own repository in it, launch the qits dev-server daemon in a workspace container, use the framed
qits UI through the web view, and verify telemetry from the child arrived in the parent.

This is the acceptance walk for
[qits dogfooding](../../../epics/qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md); the
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

Then open the **`testing-repo-quarkus-angular`** sibling's detail page and run **import
submodules** once there (imports *its* nested `webui` gitlink). Import is one level per repository
with no descent — running it again on the qits-backend parent is a no-op (its three direct edges
already exist), so the nested edge must be imported on the child that declares it.

*Expect:* the repository appears with a `main` workspace; the creation-time import lists
`testing-repo`, `qits-fixture-angular`, `testing-repo-quarkus-angular` as sibling repositories,
and the pass on the quarkus-angular child imports its `src/main/webui` edge (which links back to
the already-imported `qits-fixture-angular` sibling rather than adding a new one).

### 7. Verify the auto-provisioned daemon, then start it

The daemon is **not created by hand any more**: qits-backend commits a root
[`.qits-config.yml`](../../../../.qits-config.yml) that declares the `qits dev server` daemon (start
script, otel, web view 8080/`projects`, ready pattern `(?i)Listening on: http`, LOG_LEVEL + PATTERN
observers, the `service/quarkus.log` FILE source, both health checks) plus the build/test/lint
actions. That file is **ingested on clone**
([config-in-repo feature](../../../epics/qits-project-repositories/features/2026-07-18_qits-config-in-repo-configuration.md)), so
after step 6 the daemon and actions already exist, config-managed and read-only.

Confirm on the repository detail page (or via the API) that a daemon named **`qits dev
server@qits-config`** is present with a `.qits-config` badge, `origin: CONFIG`, web view 8080 /
`projects`, otel on — and that the six actions `build`, `test-domain`, `test-service`, `test-cli`,
`format-check`, `lint-frontend` arrived with the reserved `@qits-config` name suffix. Then **start
it on the `main` workspace** (Daemons panel → start; the workspace container materializes lazily on
this first use).

*Expect:* the daemon and actions appear with no manual data entry (config warning empty). First
launch takes long (full in-container reactor + pnpm build; warm shared `m2`/`pnpm` caches speed it a
lot). Status reaches `READY`; both health dots (Quarkus COMMAND, Angular HTTP) go green.

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

- spans from **`qits dev server@qits-config-browser`** (the child SPA: `documentLoad`,
  `documentFetch`/`resourceFetch`, `Navigation`, `click`) — the browser half of the relay. The
  service name carries the daemon's `@qits-config` suffix because the daemon was ingested from the
  config file (§7); the `-browser` suffix is the SPA half;
- spans from the child **backend** — Quarkus server spans under service name **`qits-forwardauth`**
  (from its artifact): `HTTP GET`, `GET /auth/me`, `GET /projects`, …;
- **no** spans for `/otel/v1/*`, `/daemon/*`, `/git/*`, `/mcp/*` (the suppress list);
- the *Logs* view shows the child's log records (severity-classified).

### 10. Capture round-trip (optional but recommended)

In the framed child UI, click the floaty **Capture this page into qits** button, pick an element.

*Expect:* a new `feature/<timestamp>` workspace appears in the **parent** (capture posts same-origin
to the parent's `/api/capture`), and the top window navigates to its `/wip` goal page; the goal
carries the DOM snapshot + "Selected component" / "Rendered DOM" sections.

The `promptContext` **state** entry only rides along if the child's `PromptContextStore` was
instantiated during the session — a `providedIn: 'root'` signal store is created lazily on first
injection, and only the file-browser / command-chat / speak-to-prompt / daemon-webview routes inject
it. Captured from the fresh **Projects** route it is **absent** (no "## App state at capture"
section); reach one of those routes first to see it. Tracked in
[`docs/issues/2026-07-18_capture-promptcontext-absent-on-lazy-store.md`](../../../issues/2026-07-18_capture-promptcontext-absent-on-lazy-store.md).

## Acceptance checklist

- [ ] Both images build from a plain checkout (no submodules).
- [ ] Packaged container healthy; `401` without `Remote-User`, identity echoed with it.
- [ ] qits-backend registered with two-level submodule import (nested edge on the child); workspace
      container materializes.
- [ ] `.qits-config.yml` ingested on clone: `qits dev server@qits-config` daemon + the six
      `@qits-config` actions present, config-managed, `configWarning` empty.
- [ ] Daemon reaches `READY`; both health dots green.
- [ ] Framed child UI usable through the web view, all requests under the proxy prefix.
- [ ] Parent telemetry shows child browser **and** backend spans + logs; suppressed paths absent.
- [ ] (Optional) Capture from the frame creates a parent workspace with the DOM/component snapshot
      (the `promptContext` state entry only when the store was instantiated — see step 10).

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
- **`.env`'s `QITS_WORKSPACE_GIT_HOST` seems ignored (packaged qits still answers the `qits`
  alias)** → you are running the walk **from inside the devcontainer**, which exports
  `QITS_WORKSPACE_GIT_HOST=qits` in the shell, and Docker Compose gives shell env precedence over
  the `.env` file. Pass the alias inline so it wins:
  `QITS_WORKSPACE_GIT_HOST=qits-mat docker compose -f docker-compose.prod.yml -f …/compose.local-port.yml up -d`
  (recreate the container after fixing). Symptom otherwise is the two-stacks-on-`qits-net` alias
  collision (`docs/issues/2026-07-17_two-stacks-collide-on-qits-net-alias.md`).
- **`curl http://127.0.0.1:18080/…` returns nothing from inside the devcontainer** → the loopback
  port is published on the **host** network namespace, unreachable from another container. Drive the
  packaged qits by its qits-net DNS name instead (`http://qits-qits-1:8080`, the compose
  service/container name). The `127.0.0.1:18080` overlay is for a human on the host.
