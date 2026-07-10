---
name: screenshot-tests
description: How to write, run, and debug visual-regression "screenshot tests" (Vitest browser mode, *.browser.spec.ts). Use when adding or fixing a screenshot/visual test, regenerating a baseline PNG, or when a visual test is clipped, cut off, or failing.
---

# Screenshot Tests (Visual Regression)

## What it is

A screenshot test renders a component in a **real headless Chromium** (Vitest browser mode, driven by Playwright) and compares the rendered pixels against a committed baseline PNG. The test **fails on pixel drift** — so a human and the agent review identical graphics when something changes.

- Spec files are named **`*.browser.spec.ts`**.
- They run **only** via `pnpm test:visual`. The normal `pnpm test` **excludes** them (see the `test` vs `test-visual` targets in `angular.json`), so they never run in the unit suite.
- Baselines live colocated with the spec at `__screenshots__/<spec-file>/<name>-chromium-linux.png` and are **committed to git**.
- Stack: `@vitest/browser` + `@vitest/browser-playwright` + `playwright` (chromium), via the `@angular/build:unit-test` builder.

## Run it

```bash
pnpm test:visual        # = ng run qits-ui:test-visual
```

Config is the `test-visual` target in `angular.json`:

```json
"test-visual": {
  "builder": "@angular/build:unit-test",
  "options": {
    "buildTarget": "qits-ui:build",
    "browsers": ["chromium"],
    "headless": true,
    "browserViewport": "820x1200",
    "include": ["src/**/*.browser.spec.ts"]
  }
}
```

## Create one

Wrap the component under test in a tiny host component, render it into `document.body`, then assert with `toMatchScreenshot`. Copy this pattern (from `src/app/ui/components/repository/commit-row.browser.spec.ts`):

```typescript
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { CommitRowComponent } from './commit-row.component';

// Deterministic fixture — stable hashes/dates, no new Date()/Math.random().
@Component({
  imports: [CommitRowComponent],
  template: `
    <div data-testid="commit-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col gap-2">
        @for (c of commits; track c.hash) {
          <app-commit-row [commit]="c" />
        }
      </div>
    </div>
  `,
})
class CommitListHost {
  readonly commits = COMMITS;
}

describe('CommitRowComponent (visual)', () => {
  it('renders a branch commit log', async () => {
    const fixture = TestBed.createComponent(CommitListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('commit-list')).toMatchScreenshot('commit-list');
  });
});
```

Rules that matter:

1. **Put a `data-testid` on the host's root div and give it a fixed width.** `toMatchScreenshot` captures exactly the element returned by `page.getByTestId(...)`, so the testid root *is* the screenshot frame.
2. **Render presentational / dumb components, not smart ones.** Smart components need TanStack Query / HTTP wiring that makes captures async and flaky. Build a host that feeds the dumb component plain fixture data, laid out the same way the real parent lays it out.
3. **Deterministic data only.** Stable commit hashes, fixed ISO dates, no `new Date()` / `Math.random()`. (Note: `DatePipe` renders in the machine timezone — see Debugging.)
4. **Lifecycle: `detectChanges()` → `await whenStable()` → `detectChanges()`** before asserting, so async rendering settles.
5. Name the snapshot (`toMatchScreenshot('commit-list')`) — that string becomes the PNG filename.

## Baselines & regeneration

- **First run with no baseline fails on purpose.** You'll see *"No existing reference screenshot found; a new one was created. Review it before running tests again."* — that is expected. Inspect the new PNG, then run `pnpm test:visual` again; now it passes.
- **To update a baseline after an intentional UI change**, delete the stale PNG and re-run twice:
  ```bash
  rm src/app/.../__screenshots__/<spec>.browser.spec.ts/<name>-chromium-linux.png
  pnpm test:visual   # creates the new baseline (reports "fail" by design)
  pnpm test:visual   # verifies it now matches → passes
  ```
- **Commit the regenerated PNGs** alongside the code change that justified them.

**Producing toolchain (baseline provenance).** The committed baselines are only reproducible on the exact browser build **and font stack** that rendered them. `playwright` is pinned by `pnpm-lock.yaml` (currently `1.61.0` → Chromium revision 1228 = **Google Chrome for Testing 149.0.7827.55**), so the browser build is fixed — but the **host font stack is not pinned**, and text rasterization drifts with it. All current baselines were (re-)recorded on **Chromium 149.0.7827.55** on the devcontainer's font stack (2026-07-10). If a baseline fails with only small sub-pixel drift (a low differ-ratio, no dimension change) and no relevant component changed, suspect a font-stack change on the runner — re-record on the current toolchain. When you re-record for that reason, update this version line so the provenance stays current. A durable fix (bake the Playwright cache + fonts into `docker/workspace` so every environment renders identically) is tracked in [`docs/backlog-ideas/screenshot-baseline-renderer-baked-into-image.md`](../../../../../../../docs/backlog-ideas/screenshot-baseline-renderer-baked-into-image.md).

## Debugging / gotchas

| Symptom | Cause & fix |
|---|---|
| Bottom of a tall element is cut off; white space below it | The element renders taller than the viewport height, and parts (e.g. a `z-tree`/CDK list) only realize within the viewport. **Increase the height** in `angular.json` `test-visual` `browserViewport` (this project was bumped `720x600` → `820x1200`). |
| Right side clipped (e.g. last button cut off) | Content overflows the host's fixed width. Make the real layout fit (e.g. `flex-wrap` on the action row) or widen the host `style="width: …"`. A clip here is usually a genuine responsive bug worth fixing in the component, not just the test. |
| A baseline you didn't touch suddenly fails | A **shared dumb component changed**. Visual tests render real components, so editing `branch-row` (a button, padding) shifts the `branch-tree` baseline that embeds it. Regenerate the affected baselines too. |
| PNG looks lower-res than the CSS pixels (e.g. 820px viewport → ~432px PNG) | Headless capture uses a **sub-1 device scale factor**. Expected, legible, not a bug — don't chase it. |
| Passes locally, fails on another machine / CI | **Time/locale-dependent rendering.** `DatePipe` formats in the machine's timezone, so a fixed ISO date can render different clock text. Keep fixtures timezone-stable and avoid any runtime clock/locale in what you capture. |

## Reference

Working examples in this repo:

- `src/app/ui/components/repository/commit-row.browser.spec.ts` → `__screenshots__/commit-row.browser.spec.ts/commit-list-chromium-linux.png`
- `src/app/ui/components/repository/branch-tree.browser.spec.ts` → `__screenshots__/branch-tree.browser.spec.ts/workspace-tree-chromium-linux.png`
