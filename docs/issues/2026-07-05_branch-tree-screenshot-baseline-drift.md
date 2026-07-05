# branch-tree visual-regression baseline no longer matches (dimension drift)

## Introduction

Found while running the webui browser suite (`pnpm test:visual`) during the
[daemon web-view picker](../features/2026-07-05_daemon-webview-picker.md) implementation. Unrelated
to that feature — the failure reproduces on a clean checkout with no working-tree changes. No other
plans depend on this; the other three browser specs (commit-row, file-viewer, dom-picker) pass.

## Observed

`ng run qits-ui:test-visual` fails in
`src/app/ui/components/repository/branch-tree.browser.spec.ts`:

```
nests children of children with the zard tree and shows ahead/behind counts
Expected image dimensions to be 432×696px, but received 432×776px.
```

The committed baseline (`__screenshots__/branch-tree.browser.spec.ts/worktree-tree-chromium-linux.png`,
432×696) is 80px shorter than what the component renders today (432×776); the diff artifact lands
under `.vitest-attachments/`. Verified 2026-07-05 on `main` with a stashed working tree.

## Suspected cause

The `BranchTreeComponent` (or the zard tree/its styles) grew taller since the baseline was
captured — e.g. an added row, padding, or font-metric change — and the baseline was never
re-recorded. This is baseline staleness, not a rendering bug: the actual screenshot looks like a
plausible current render of the fixture tree.

## Suggested fix direction

Inspect `.vitest-attachments/.../worktree-tree-actual-chromium-linux.png` against the baseline; if
the new render is intentional (it accompanied whatever component change landed since), re-record
the baseline (delete the stale PNG and re-run `pnpm test:visual` to regenerate, per
`.pi/skills/screenshot-tests`). If the extra 80px is unintentional, bisect the component/styles
first.
