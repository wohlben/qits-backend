# Packaged fast-jar serves no Angular SPA (quarkus-undertow breaks Quinoa prod serving)

## Introduction

Related/dependent plans:

- `docs/guides/deployment.md` — the deployment this bug was found while validating (the first time qits
  ran as a packaged fast-jar rather than `quarkus:dev`).
- `docs/features/2026-07-05_spa-observability.md`, `docs/guides/quarkus-angular-integration.md` — the
  Quinoa/Angular serving contract this violates in prod.
- `service/src/main/java/eu/wohlben/qits/githost/QitsGitServlet.java` + `service/pom.xml`
  (`quarkus-undertow`, `org.eclipse.jgit.http.server`) — the servlet git host that forces undertow onto
  the classpath; removing undertow here is the fix direction.
- `service/src/main/java/eu/wohlben/qits/spa/DevModeSpaFallbackRoute.java` — a **dev-only** deep-link
  workaround; NOTE its comment "the packaged build handles it" is an untested assumption this bug
  disproves, but the class itself is unrelated to the prod root cause (it does not touch prod serving).

## Symptom

In the **packaged** app image (`docker/qits/Dockerfile` → `qits/app:latest`, running the fast-jar),
the REST API and health work but the web UI does not:

| Request | Result |
|---|---|
| `GET /q/health/ready` | 200 (UP) |
| `GET /api/projects` | 200 |
| `GET /` | **403 Forbidden** (Undertow "Forbidden" error page) |
| `GET /index.html` | **404** |
| `GET /favicon.ico`, `/main-*.js`, `/styles-*.css`, `/angular.svg` | **404** |
| `GET /some/spa/route` | **404** (SPA fallback never fires) |

This is **not** a packaging problem: the Angular build IS baked into the jar. Quinoa built it
(`Application bundle generation complete`, `Quinoa target directory … containing 203 resources`) and
the assets are present at the web root inside `quarkus/generated-bytecode.jar`:
`META-INF/resources/index.html` (12 KB), `main-NKZE6T53.js`, `styles-*.css`, `favicon.ico`, 200×
`chunk-*.js`. They are simply never **served**.

## Repro

Build + run the packaged image (any of: `install.sh`, the by-hand `docker build` steps, or the
throwaway-container one-liner in `docs/guides/deployment.md`), then from inside the container:

```bash
docker exec qits-qits-1 curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/            # 403
docker exec qits-qits-1 curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/favicon.ico # 404
docker exec qits-qits-1 curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/q/health/ready # 200
```

## Root cause (confirmed by a controlled experiment)

**`quarkus-undertow` breaks Quinoa's production static serving.** qits pulls in `quarkus-undertow`
solely for JGit's `GitServlet` (`/git/*`). Its mere presence stops Quinoa's **generated** static
resources from being wired into the runtime static route.

Evidence (all reproduced locally by packaging the fast-jar and running `java -jar`, no docker):

1. The assets are physically bundled at the right web-root path — `generated-bytecode.jar` contains
   `META-INF/resources/index.html` (12 KB), `main-*.js`, `styles-*.css`, `favicon.ico`, 200× `chunk-*.js`.
   So Quinoa's Angular-output detection and bundling are correct (that Angular-17+ issue was fixed in
   Quinoa 2.4.2; we're on 2.8.1).
2. A hand-placed `src/main/resources/META-INF/resources/ping.txt` — an **application-archive** static
   resource — **serves 200**. So Quarkus' Vert.x static handler is alive and serving. It's specifically
   the **generated** resources (Quinoa's, in `generated-bytecode.jar`) that 404.
3. The **undertow "default servlet" is NOT the shadow.** A `ServletExtension` that removed it (leaving
   servlets `[git, @QuarkusError]`) changed nothing — `/` still 403, assets still 404. And `ping.txt`
   still served *without* the default servlet, proving app-archive static serving doesn't go through it.
4. **The decisive control:** the `testing-repo-quarkus-angular` fixture — the same Quinoa + Angular
   stack, deliberately "shaped like qits", but with **no `quarkus-undertow`** — packages and serves its
   SPA perfectly in prod: `GET /` → 200 (`<app-root>`, `<title>Quarkus + Angular fixture`, `main-*.js`),
   `GET /index.html` → 200. The only HTTP-layer difference from qits is undertow.

So the earlier "undertow default-servlet route shadows Quinoa (order 10000 vs 40000)" theory — including
the `DevModeSpaFallbackRoute` comment "the packaged build handles it" — is **wrong**. The real effect is
at build time: with undertow on the classpath, Quinoa's `GeneratedStaticResourcesBuildItem` is not
served by the Vert.x static route the way it is in a non-servlet app. (`DevModeSpaFallbackRoute` remains
a separate, dev-only deep-link workaround; it does not touch prod serving.)

## Suggested fix direction

Make Quinoa work by **removing `quarkus-undertow`** — serve the JGit smart-HTTP git host with a
Vert.x-native handler instead of a servlet, so the HTTP layer matches the working fixture. JGit exposes
the protocol without a servlet container via `UploadPack`/`ReceivePack` (+ `RefAdvertiser`); a small set
of Vert.x routes under `/git/:repo/*` (`GET .../info/refs?service=…`, `POST .../git-upload-pack`,
`POST .../git-receive-pack`) replaces `QitsGitServlet`. This is the change the fixture proves correct,
and it also lets Quinoa's own SPA-routing (order 40000) work for deep links.

Alternatives to weigh (all lighter but hackier and none confirmed): a `ServletExtension` that gives
undertow's default servlet a `ClassPathResourceManager("META-INF/resources")` so it serves the generated
assets (doesn't solve SPA deep-link fallback); running the git host on a separate HTTP port/server so it
never joins the main router; or a Quinoa/Quarkus config knob forcing Vert.x static serving (none found).

Add a regression test that packages/prod-launches and asserts `GET /` → 200 + `index.html` and a deep
link (`GET /projects/x`) → 200 (a plain `@QuarkusTest` runs in test mode where Quinoa doesn't build the
UI, so this likely needs an `@QuarkusIntegrationTest` against the packaged app, or a smoke check in the
deployment container test).

## Impact

The deployment **pipeline** is otherwise fully working (one-command build → healthy container → docker
socket access → REST API). But a server deployed before the fix served the API and not the UI, so this
blocked a usable end-user deployment. Backend-only integrations (git host, MCP, OTLP, the API) were
unaffected.

## Resolution (2026-07-15)

Fixed by **removing `quarkus-undertow`** and reimplementing the JGit git host as Vert.x routes:

- `service/src/main/java/eu/wohlben/qits/githost/GitHostRoutes.java` — new `@ApplicationScoped` bean
  that registers `/git/:repoId/info/refs` (GET) and `/git/:repoId/git-(upload|receive)-pack` (POST) on
  the main Vert.x router (blocking handlers, body buffered by a `BodyHandler`) and drives JGit's
  `UploadPack`/`ReceivePack` + `PacketLineOutRefAdvertiser` directly. Replaces `QitsGitServlet` +
  `QitsRepositoryResolver` (both deleted).
- `service/pom.xml` — dropped `quarkus-undertow` and `org.eclipse.jgit.http.server`; kept
  `org.eclipse.jgit` (core) directly. The `service` module now has **no servlet container**.
- `DevModeSpaFallbackRoute` kept (still needed for the dev-mode deep-link case,
  `docs/issues/resolved/2026-07-05_dev-mode-spa-deep-links-404.md`); its undertow-based comments were
  corrected.

Verified on the packaged fast-jar (`java -jar`): `GET /` → 200 (Angular index), `/index.html`,
`/favicon.ico`, and a deep link `/projects/x` → 200 (Quinoa's SPA routing now works). `GitHostTest`
(real `git clone` + `push` over `/git/*`, `info/refs`, 404s, traversal rejection) passes 4/4, and the
full `service` suite is green (259 tests). The controlled comparison stands: the no-undertow fixture
served fine all along; qits now matches it.
