# Epic: qits-build-setup — build & test environment tooling

## Introduction

The **build & test setup domain**: the infrastructure that makes building and testing qits fast
and reproducible — the Maven reactor build cache, and the pinned toolchain **image** the
devcontainer and workspace containers build on (where visual baselines are produced). These are
not product features; they are the dev/CI substrate that everything else is built and verified
against.

**Cross-cutting infrastructure epic**, not part of the projects → repositories → workspaces
aggregate chain. Retroactive umbrella epic; future build/test-tooling work (Spotless config, the
dev-guard, the m2e-separate-output profile, toolchain bumps, image slimming) lands here.

Related epics / cross-cutting concerns:

- **The image is also the workspace runtime** — the `docker/workspace` image is the base every
  [workspace container](../qits-workspaces/epic.md) runs, and the `.devcontainer/` that
  **extends** it (joining `qits-net`) is [qits-live-deployment](../qits-live-deployment/epic.md)'s
  concern. This epic owns *what is baked into* that image; those own *running* it.
- **Why the renderer pin matters** — the baked renderer is the **sole sanctioned producer** of
  qits' committed visual baselines, and the pinned-renderer discipline it establishes is the
  precedent the [qits-userflows](../qits-userflows/epic.md) golden loop reuses (cross-branch
  comparison requires both sides come from the same renderer image).
- **Distinct from fixtures** — [qits-testing-fixtures](../qits-testing-fixtures/epic.md) owns the
  fixture *repositories*; this epic owns the *image* their (and qits') visual tests render on.

## Parts (implemented)

- **[maven-build-cache](features/2026-07-05_maven-build-cache.md)** (07-05) — the Maven Build
  Cache Extension (local disk): fingerprint each module's inputs and, on a hit, restore its
  outputs (compile, Spotless, tests, and the pnpm/Angular build) instead of rebuilding.
- **[screenshot-baseline-renderer-baked-into-image](features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md)**
  (07-13) — bake a pinned renderer (Playwright-managed Chromium) **and** a fixed font set into
  the `docker/workspace` image so "fresh machine" and "CI" always mean the *same* renderer;
  visual baselines stop drifting and that image becomes their sole sanctioned producer.

## Done when

Rolling: current when its `feature-ideas/` is empty and every build/test-tooling feature since
this epic's creation has landed here.

## Status

| Part | Status |
|---|---|
| [maven-build-cache](features/2026-07-05_maven-build-cache.md) | implemented |
| [screenshot-baseline-renderer-baked-into-image](features/2026-07-13_screenshot-baseline-renderer-baked-into-image.md) | implemented |
