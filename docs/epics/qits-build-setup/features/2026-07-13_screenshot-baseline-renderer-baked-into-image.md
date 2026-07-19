# Screenshot-baseline renderer baked into `docker/workspace`

> **Status: implemented 2026-07-13.** Originally a backlog idea
> (`docs/backlog-ideas/screenshot-baseline-renderer-baked-into-image.md`), picked up ahead of its
> third-recurrence trigger.

## Introduction

The [screenshot tests](../../../../service/src/main/webui/.pi/skills/screenshot-tests/SKILL.md) render
real components in a headless Chromium and diff the pixels against committed baseline PNGs. Those
baselines are only reproducible on the **exact browser build and font stack** that produced them.
This feature makes "fresh machine" and "CI" always mean the *same* renderer, so baselines stop
drifting out from under a clean checkout: the renderer (Playwright-managed Chromium) **and** a
pinned font set are baked into the `docker/workspace` image, and that image is the sole sanctioned
producer of baselines.

Related/dependent plans:

- Modifies the `docker/workspace` image described in
  [workspace containers](../../qits-workspaces/features/2026-07-04_workspace-containers.md); the `.devcontainer/` that extends it
  (see [qits-net devcontainer unification](../../qits-live-deployment/features/2026-07-07_qits-net-devcontainer-unification.md))
  inherits the renderer with no changes of its own.
- Complements the already-implemented screenshot-test setup (the `test-visual` target in
  `service/src/main/webui/angular.json` + the committed baselines) — the tests themselves are
  unchanged; only where they are sanctioned to run changed.
- Resolves the recurring baseline drift documented in
  [visual baselines drift on fresh Chromium](../../../issues/resolved/2026-07-10_visual-baselines-drift-on-fresh-chromium.md)
  and its predecessor
  [branch-tree baseline drift](../../../issues/resolved/2026-07-05_branch-tree-screenshot-baseline-drift.md).

## The problem it solves

- `service/src/main/webui/package.json` pins `playwright` in a semver range; `pnpm-lock.yaml`
  resolves it exactly (`1.61.0` → Chromium revision 1228 = Google Chrome for Testing
  149.0.7827.55). So the **browser build was already pinned by the lockfile** — the drift was not
  from a floating Chromium.
- The **font stack was not pinned**. Chromium rasterizes text with whatever fonts the host
  provides, so the same component rendered subtly different glyph pixels on two machines with
  different installed fonts — the residual variable behind every "a baseline I didn't touch
  suddenly fails with a tiny differ-ratio" report.
- The Playwright browser cache (`~/.cache/ms-playwright/…`) was installed ad hoc per environment
  via `pnpm exec playwright install chromium`; nothing baked it into an image.

## What was built

All in `docker/workspace/Dockerfile`, in three layers placed **above** the frequently-bumped
`CLAUDE_CODE_VERSION` layer (so Claude Code bumps don't re-download the ~700 MB browser layer):

1. **Pinned font set** (own layer; changes essentially never): `fontconfig`, `fonts-dejavu-core`
   (Chromium's default Linux sans-serif fallback), `fonts-liberation` (metric-compatible
   Arial/Helvetica/Times), `fonts-noto-core` + `fonts-noto-color-emoji` (broad Unicode/emoji
   fallback). Versions are fixed by the `debian:bookworm-slim` base pin.
2. **Playwright Chromium baked at build time**: `ARG PLAYWRIGHT_VERSION=1.61.0` (must match what
   `service/src/main/webui/pnpm-lock.yaml` resolves — the Dockerfile comment carries the grep) and
   `npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium`, installed to the fixed
   path `ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` (world-`a+rX`). The fixed path matters:
   workspace containers run as an arbitrary uid with `HOME=/workspace`, the devcontainer as `dev`
   with `HOME=/home/dev` — a per-HOME cache would be invisible to both. `--with-deps` also
   apt-installs Chromium's shared libraries and supplemental fonts (unifont, CJK, …).
3. **Provenance file** `/etc/qits-renderer-provenance`, generated at build: the playwright
   version, the exact Chromium build (`chrome --version`), and `dpkg-query` output for
   `fontconfig` + every `fonts-*` package (the glob deliberately captures the supplemental fonts
   `--with-deps` pulled in, so provenance reflects the *actual* font surface). A drift is now
   immediately diagnosable as "the image changed" rather than "someone's laptop fonts changed."

The screenshot-tests skill's baseline-provenance note was rewritten to name the image as the sole
sanctioned producer and to point at the provenance file.

## The bump contract

A baseline re-record is now a **reviewable, intentional event**, never incidental host drift:

- Bumping `playwright` in `package.json`/`pnpm-lock.yaml` **requires** bumping
  `ARG PLAYWRIGHT_VERSION` in `docker/workspace/Dockerfile`, rebuilding the image
  (`docker build -t qits/workspace docker/workspace`), and re-recording the baselines — all in one
  reviewed change.
- Forgetting the rebuild fails loudly at test time with
  `Executable doesn't exist at /opt/ms-playwright/…`. That error means **"rebuild the image"**,
  never "run `playwright install` locally" — a local install would reintroduce an unsanctioned
  renderer.
- The devcontainer picks the renderer up on its next rebuild (VS Code "Rebuild Container"); it
  needs no changes of its own since `ENV PLAYWRIGHT_BROWSERS_PATH` and `/opt/ms-playwright` are
  inherited from the base image.

## Decisions made during implementation

- **Provenance as a file, not a `LABEL`**: workspace containers have no docker CLI, so an
  in-container `cat /etc/qits-renderer-provenance` beats a label only the host daemon can read.
- **Full Chromium, not `--only-shell`**: playwright 1.61 installs both `chromium` and the headless
  shell; the vitest headless run uses the shell, but full Chromium survives headed/UI-mode
  debugging and is what the provenance layer version-checks. `--only-shell` is the documented
  escape hatch if image size ever matters (~400 MB uncompressed).
- **`npx`, not pnpm, at image build**: no `package.json` exists in the build context; `npx -y
  playwright@<ARG>` keys the browser download to the same version the lockfile resolves.
- **Pinning `pnpm@latest` → a fixed version was deemed out of scope**: pnpm's own version cannot
  affect rendered pixels (the lockfile pins what it installs).
- **All five baselines were re-recorded on the baked image** (verify-first: run the existing
  baselines on the new renderer, re-record what fails). All five failed with the font-drift
  fingerprint (small differ-ratio, no dimension change) against the old devcontainer's ad-hoc font
  stack — confirming the diagnosis — and pass deterministically (twice in a row, 25/25) after
  re-recording.
