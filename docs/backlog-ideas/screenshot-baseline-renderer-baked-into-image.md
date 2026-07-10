# Bake the Playwright renderer + font stack into `docker/workspace`

## Introduction

The [screenshot tests](../../service/src/main/webui/.pi/skills/screenshot-tests/SKILL.md) render
real components in a headless Chromium and diff the pixels against committed baseline PNGs. Those
baselines are only reproducible on the **exact browser build and font stack** that produced them.
This backlog idea makes "fresh machine" and "CI" always mean the *same* renderer, so baselines stop
drifting out from under a clean checkout.

Related/dependent plans:

- Modifies the already-implemented screenshot-test setup (the `test-visual` target in
  `service/src/main/webui/angular.json` + the committed baselines). This is a change to that code,
  not a parallel design.
- Modifies the `docker/workspace` image and the `.devcontainer/` that extends it (see
  [qits-net devcontainer unification](../features/2026-07-07_qits-net-devcontainer-unification.md)) —
  the natural place to pin the renderer, since qits development already runs inside that container.
- Resolves the recurring baseline drift documented in
  [visual baselines drift on fresh Chromium](../issues/resolved/2026-07-10_visual-baselines-drift-on-fresh-chromium.md)
  and its predecessor
  [branch-tree baseline drift](../issues/resolved/2026-07-05_branch-tree-screenshot-baseline-drift.md).

## What exists today (the code being changed)

- `service/src/main/webui/package.json` pins `playwright` in its semver range (`^1.61.0`);
  `pnpm-lock.yaml` resolves it exactly (`1.61.0` → Chromium revision 1228 =
  Google Chrome for Testing 149.0.7827.55). So the **browser build is already pinned by the
  lockfile** — the drift is not from a floating Chromium.
- The **font stack is not pinned**. Chromium rasterizes text using whatever fonts the host
  provides, so the same component renders subtly different glyph pixels on two machines with
  different installed fonts. That is the residual variable behind every "a baseline I didn't touch
  suddenly fails with a tiny differ-ratio" report (see the skill's Debugging table + provenance
  note).
- The Playwright browser cache (`~/.cache/ms-playwright/…`) is installed ad hoc per environment
  via `pnpm exec playwright install chromium`; nothing bakes it into an image.

## The change

Pin the renderer *and* the fonts in the image every environment already runs in:

1. In `docker/workspace` (which `.devcontainer/` extends), install a **fixed set of fonts**
   (e.g. a pinned Debian/UBI font package set — DejaVu / Liberation / Noto at a fixed version) and
   run `pnpm exec playwright install --with-deps chromium` at build time so the browser cache is
   baked into the image layer, keyed to the `playwright` version the lockfile resolves.
2. Record the baked toolchain (Chromium build + font package versions) in the image and in the
   screenshot-tests skill's provenance line, so a drift is immediately diagnosable as "the image
   changed" rather than "someone's laptop fonts changed."
3. Re-record all baselines once on the baked image and treat that image tag as the sole sanctioned
   producer of baselines going forward. A baseline re-record then requires bumping the image, which
   is a reviewable, intentional event rather than incidental host drift.

## Trigger

Pick this up when baseline drift recurs a **third** time on an unchanged component (this issue is
already the second occurrence), or when screenshot tests start running in CI on a runner whose font
stack differs from the devcontainer — whichever comes first. Until then, the documented
regenerate-on-current-toolchain workflow in the skill is the cheap stopgap.
