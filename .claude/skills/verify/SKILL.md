---
name: verify
description: Build, launch and drive qits end-to-end to verify a change at its real surface (the Angular UI on :8080 backed by quarkus:dev), using the seed-webapp fixture and agent-browser.
---

# Verify a qits change end-to-end

## Build + launch

```bash
pkill -f quarkus:dev            # never build under a running dev mode — it wedges
./mvnw install -DskipTests      # cli + domain must be in the local repo
./mvnw -pl service -am quarkus:dev -Dquarkus.bootstrap.workspace-discovery=true  # bg; UP when /q/health 200 (~5 min cold)
./mvnw -pl cli quarkus:run -Dcli.args=seed-webapp   # idempotent-by-reset demo fixture
```

`seed-webapp` needs the service running and docker + the `qits/workspace` image
(`docker build -t qits/workspace docker/workspace`).

**Web-view verification requires the devcontainer.** The daemon web view reaches the workspace
container by its DNS name on the shared `qits-net`, so qits must be *on* that network — i.e. run the
build/launch above **inside `.devcontainer/`** (`devcontainer up`, or VS Code "Reopen in Container"),
which puts qits on `qits-net` (alias `qits`) and forwards `127.0.0.1:8080`/`:4200` for the browser.
Other surfaces (UI, telemetry, daemon start) work with a plain host `quarkus:dev`; only the web-view
iframe needs the devcontainer. See `docs/epics/qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md`.

## Drive (agent-browser via `npx -y agent-browser`)

- **Deep links work in dev** since `DevModeSpaFallbackRoute` (order-9000 reroute; see
  `docs/issues/resolved/2026-07-05_dev-mode-spa-deep-links-404.md`) — open
  `http://localhost:8080/repositories/{repoId}/workspaces/{wsId}` directly. UI path if you need
  it: Projects → "Quarkus + Angular Demo" → repository **View** → the greeting workspace's
  **Work on it**.
- **Gotcha: agent-browser ref-clicks (`click @eN`) silently no-op on some Angular buttons**
  (e.g. the branch tree's "Work on it"). Fall back to a JS click:
  `eval "(() => { [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Work on it')).click(); })()"`.
  Ref-clicks work fine on other buttons (e.g. "View") — try ref first, verify the URL changed.
- **Tab strip selector**: `[role="tab"]` works (the z-button role clobber is fixed — see
  `docs/issues/resolved/2026-07-06_tab-buttons-lose-role-tab-to-z-button.md`).
- Start the workspace daemon from the Daemons panel, then poll
  `/api/repositories/{repoId}/workspaces/greeting/daemons` until `status == "READY"` (~1 min).
- The web view (bottom-right "Web view" floaty) hosts the fixture app in an iframe; the fixture
  SPA posts `POST /api/greetings` on load, so opening it already generates a trace + logs.
- Telemetry endpoints for direct probing:
  `/api/repositories/{repoId}/workspaces/{wsId}/telemetry/{errors,slow-spans,logs,metrics,traces/{traceId}}`.
- `agent-browser console` accumulates for the whole browser session — `close --all` and redrive
  for a clean before/after (e.g. hunting NG0955).

## Cleanup

`npx -y agent-browser close --all`; kill the background quarkus:dev. Re-running `seed-webapp`
resets the demo project to known-good.
