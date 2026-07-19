# Acceptance: artifactory golden upload + query round-trip

## Introduction

Accepts the **[qits-artifactory](../../../epics/qits-artifactory/features/2026-07-19_qits-artifactory.md)**
store end-to-end on a realistically deployed qits: from a workspace container on `qits-net`, an action
script uploads a real screenshot and a real video with the metadata convention through the `qits`
alias, and the golden query returns both — the loop the store exists to enable. It complements the
automated `artifactory` + `service` suites (which never touch docker or a real container) by proving
the container→qits reachability and the on-disk/served bytes end to end.

Related: the store feature doc (above); the producer convention worked example within it;
[qits-net](../../../epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md) for the
container→qits alias.

## Preconditions

- The devcontainer is up (`devcontainer up` / VS Code "Reopen in Container"), so qits runs on
  `qits-net` reachable by workspace containers as `qits`.
- The workspace image is built: `docker build -t qits/workspace --target workspace -f docker/qits/Dockerfile .`
- qits is running (packaged image or `./mvnw -pl service -am quarkus:dev …`). At boot,
  `ci-screenshots` and `ci-videos` self-seed.
- A repository + workspace exist to run an action in (the `seed-webapp` fixture is fine:
  `./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp`).
- If `qits.artifactory.token` is set on this deployment, export it into the workspace as
  `QITS_ARTIFACTORY_TOKEN` (the devcontainer/dev default is blank → the guard is a no-op).
- Expected duration: ~10 minutes.

## Steps

1. **Confirm the default repositories self-seeded.** From the qits host/devcontainer terminal:
   ```bash
   curl -fsS localhost:8080/api/artifactory/repositories | jq
   ```
   *Expect:* a list containing `{"name":"ci-screenshots","type":"ci-screenshots"}` and
   `{"name":"ci-videos","type":"ci-videos"}`.

2. **Open a shell inside a workspace container** (materialize one via the UI or reuse the seed-webapp
   `greeting` workspace), then confirm the alias is reachable:
   ```bash
   curl -fsS http://qits:8080/api/artifactory/repositories >/dev/null && echo reachable
   ```
   *Expect:* `reachable` — the container reaches qits by DNS name, no host-port publishing.

3. **Upload a real screenshot** from inside the container (produce one with any tool, e.g. a
   Playwright run, or `import`/`scrot`; here `shot.png` at 1440x900):
   ```bash
   curl -fsS -X POST http://qits:8080/api/artifactory/repositories/ci-screenshots/blobs \
     ${QITS_ARTIFACTORY_TOKEN:+-H "X-Artifactory-Token: ${QITS_ARTIFACTORY_TOKEN}"} \
     -H "Content-Type: image/png" \
     -H "X-Artifactory-Meta-git.branch.name: $(git branch --show-current)" \
     -H "X-Artifactory-Meta-git.commit.hash: $(git rev-parse HEAD)" \
     -H "X-Artifactory-Meta-qits.userflow.name: checkout" \
     -H "X-Artifactory-Meta-qits.userflow.hash: $(sha256sum tests/checkout.spec.ts | cut -d' ' -f1)" \
     -H "X-Artifactory-Meta-qits.display.name: step 3 — cart" \
     -H "X-Artifactory-Meta-qits.diff.hash: $(sha256sum shot.png | cut -d' ' -f1)" \
     -H "X-Artifactory-Meta-media.resolution.width: 1440" \
     -H "X-Artifactory-Meta-media.resolution.height: 900" \
     --data-binary @shot.png | jq
   ```
   *Expect:* `201` with `{"id":"<64-hex sha256>","existing":false}`. Re-running the exact same upload
   returns `"existing":true` with the same `id`.

4. **Upload a real video** (`run.webm`):
   ```bash
   curl -fsS -X POST http://qits:8080/api/artifactory/repositories/ci-videos/blobs \
     ${QITS_ARTIFACTORY_TOKEN:+-H "X-Artifactory-Token: ${QITS_ARTIFACTORY_TOKEN}"} \
     -H "Content-Type: video/webm" \
     -H "X-Artifactory-Meta-git.branch.name: $(git branch --show-current)" \
     -H "X-Artifactory-Meta-git.commit.hash: $(git rev-parse HEAD)" \
     -H "X-Artifactory-Meta-qits.userflow.name: checkout" \
     -H "X-Artifactory-Meta-qits.userflow.hash: $(sha256sum tests/checkout.spec.ts | cut -d' ' -f1)" \
     -H "X-Artifactory-Meta-qits.display.name: full run" \
     -H "X-Artifactory-Meta-qits.diff.hash: run-$(git branch --show-current)" \
     -H "X-Artifactory-Meta-media.resolution.length: 12" \
     --data-binary @run.webm | jq
   ```
   *Expect:* `201` with an `id`.

5. **Query the goldens for this branch** (from container or host):
   ```bash
   BRANCH="$(git branch --show-current)"   # on the host, substitute the branch you uploaded for
   curl -fsS "http://qits:8080/api/artifactory/repositories/ci-screenshots/blobs?meta.git.branch.name=${BRANCH}&meta.qits.userflow.name=checkout&latest=true" | jq
   curl -fsS "http://qits:8080/api/artifactory/repositories/ci-videos/blobs?meta.git.branch.name=${BRANCH}&meta.qits.userflow.name=checkout&latest=true" | jq
   ```
   *Expect:* each returns exactly one record (the latest per branch+flow), carrying the metadata you
   sent plus a server-stamped `created-at` and `mediatype`.

6. **Serve a blob and confirm bytes + headers.** Take the screenshot `id` from step 3:
   ```bash
   curl -fsS -D- -o served.png "localhost:8080/api/artifactory/repositories/ci-screenshots/blobs/<id>"
   diff shot.png served.png && echo "byte-identical"
   ```
   *Expect:* `200`, `Content-Type: image/png`, a `Cache-Control: … immutable` header, and
   `byte-identical`. Opening the same URL in a browser renders the image (usable as an `<img>` src).

7. **Reject probes.**
   - `curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/artifactory/repositories/ci-screenshots/blobs/not-a-sha`
     *Expect:* `404` (malformed id — path-traversal defence).
   - Upload a `video/mp4` body to `ci-screenshots` *Expect:* `400` (disallowed media type).
   - If a token is configured, POST without `X-Artifactory-Token` *Expect:* `401`.

## Acceptance checklist

- [ ] `ci-screenshots` and `ci-videos` exist at boot without any manual PUT.
- [ ] A workspace container uploads a screenshot and a video through `http://qits:8080/api/artifactory/…`.
- [ ] Re-uploading identical bytes reports `existing:true` with the same id (dedupe), distinct records.
- [ ] The `latest=true` query returns exactly one record per branch+flow, with server-stamped metadata.
- [ ] Serving a blob returns byte-identical content, the stored `Content-Type`, and an immutable cache header.
- [ ] Malformed id → 404, disallowed media type → 400, and (when a token is set) a token-less write → 401.

## Cleanup

Blobs and metadata persist by design (goldens outlive workspaces). To reset a dev machine:
`rm -rf ~/.qits/data/artifactory` (drops the artifactory H2 + blobs; the repositories self-seed again
on next boot). The workspace container tears down with its workspace as usual.
