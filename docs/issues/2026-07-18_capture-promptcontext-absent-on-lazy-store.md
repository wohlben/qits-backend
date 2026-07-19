# SPA capture omits `promptContext` app state when the store hasn't been instantiated

## Introduction

Found while walking
[`docs/manual-acceptance-tests/dogfooding/packaged-qits-in-qits/plan.md`](../manual-acceptance-tests/dogfooding/packaged-qits-in-qits/plan.md)
(step 10, the capture round-trip) against a packaged qits-in-qits deployment on 2026-07-18.

Related/dependent plans:

- [`docs/epics/qits-integration-angular/features/2026-07-14_capture-state-snapshot.md`](../epics/qits-integration-angular/features/2026-07-14_capture-state-snapshot.md) —
  the `withQitsSnapshot(key)` mechanism whose registration is lazy here.
- [`docs/epics/qits-integration-angular/features/2026-07-14_spa-feature-capture.md`](../epics/qits-integration-angular/features/2026-07-14_spa-feature-capture.md) —
  the capture payload + `CaptureGoalRenderer` "App state at capture" section that is consequently absent.
- [`docs/epics/qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md`](../epics/qits-integration-quarkus/features/2026-07-18_qits-dogfooding-managed-app-convention.md) —
  qits' own `PromptContextStore` carries `withQitsSnapshot('promptContext')`; the acceptance walk
  expects a capture of the qits UI to include it.

## Observed (packaged qits-in-qits, 2026-07-18)

Capturing the framed child qits UI from its **Projects** route (fresh, empty child) with the floaty
"Capture this page into qits" button:

- Creates the parent workspace `feature-<timestamp>` (branch `feature/<timestamp>`) as expected.
- The rendered goal (`.../workspaces/<ws>/wip`) contains the DOM snapshot and "Selected component
  (style-frozen)" / "Rendered DOM (style-frozen)" sections.
- **But has no "## App state at capture" section** — the capture POST carried `state: null`, so
  `CaptureGoalRenderer` (which appends that section only `if content.stateJson() != null`) skips it.
  The `promptContext` entry the walk's step 10 expects is absent.

## Suspected cause

`PromptContextStore` (`service/src/main/webui/src/app/shared/state/prompt-context.store.ts`) is a
`signalStore({ providedIn: 'root' }, …, withQitsSnapshot('promptContext'), …)`. A `providedIn: 'root'`
signal store is a singleton but **lazily instantiated on first injection**, and `withQitsSnapshot`
registers its snapshot provider from the store's init hook — so until something injects the store,
no `promptContext` snapshot is registered and `@qits/angular` collects no state for it.

The store is injected only by `workspace-file-browser`, `command-chat`, `speak-to-prompt`, and
`daemon-webview` components — none on the Projects/shell route. Capturing from Projects (or any route
that never touched those components) therefore sends `state` without a `promptContext` key. The
snapshot mechanism is working as designed (only *live* stores contribute); the store just isn't alive
on that route.

## Suggested fix direction

One of:

1. **Eagerly instantiate `PromptContextStore`** app-wide (inject it in the root/shell component, or
   an `APP_INITIALIZER`/`provideAppInitializer` that touches it) so its snapshot is always
   registered and an empty `promptContext` still rides along with every capture. Cheap; makes the
   behavior match the walk's expectation.
2. **Register `withQitsSnapshot` providers eagerly** at `provideQitsIntegration` time rather than at
   store-init — a library-side change in `@qits/angular`, broader blast radius.
3. **Document the conditional** (least code): a capture carries a store's state only if that store
   was instantiated during the session; the plan/guide expectations are softened accordingly (done
   in the same pass that filed this issue).

Option 1 is the smallest change that satisfies the acceptance expectation; filed for later analysis.

## Not a walk blocker

The capture feature end-to-end works (parent workspace + DOM/component snapshot land in the parent);
this is the *state* enrichment being empty on an untouched route. The acceptance plan's step 10 and
checklist were updated to mark the `promptContext` entry conditional pending this fix.
