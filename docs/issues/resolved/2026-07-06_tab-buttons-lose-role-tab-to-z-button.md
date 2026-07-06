# RESOLVED: Tab buttons lose `role="tab"` to z-button's host `role="button"`

> **Resolution (2026-07-06):** fixed on the button side, as suggested — `ZardButtonComponent` now
> captures the author-provided role at construction (`authorRole`) and its host `[attr.role]`
> binding only falls back to `role="button"` when none was set. Verified live:
> `document.querySelectorAll('[role="tab"]')` on the workspace detail page returns the three tab
> buttons. Regression: `workspace-detail.page.spec.ts` asserts the tablist children carry
> `role="tab"`.

## Introduction

Found while testing the workspace observation tabs
([feature](../../features/2026-07-06_workspace-observation-tabs.md)): the `z-tab-group` tab strip is
not exposed as tabs to assistive technology. Related: the zard tabs component
(`shared/components/tabs/tabs.component.ts`) and button component
(`shared/components/button/button.component.ts`); the webui convention "Templates must pass
AXE / WCAG AA" (`service/src/main/webui/CLAUDE.md`).

## Observed

`ZardTabGroupComponent`'s nav renders each tab as

```html
<button type="button" z-button zType="ghost" role="tab" …>
```

but in the DOM the buttons carry `role="button"`, not `role="tab"` — a
`document.querySelectorAll('[role="tab"]')` on the workspace detail page returns nothing, while
`aria-selected`/`aria-controls`/`id="tab-N"` are all present. So the `role="tablist"` nav contains
`role="button"` children, which is an ARIA-pattern violation (tablist expects tab children) and
breaks screen-reader tab semantics.

## Suspected cause

`ZardButtonComponent` sets a host binding
(`service/src/main/webui/src/app/shared/components/button/button.component.ts:46`):

```ts
'[attr.role]': 'isNotInsideOfButtonOrLink() ? "button" : null',
```

Host `[attr.role]` bindings win over static attributes in the template, so the tab strip's static
`role="tab"` (`shared/components/tabs/tabs.component.ts`, the `role="tab"` button inside
`#navigationBlock`) is clobbered after the first change detection.

## Suggested fix direction

Either make the button's role binding non-destructive (only set `role="button"` when the element
has no author-provided role — e.g. read `elementRef.nativeElement.getAttribute('role')` once and
keep it), or stop using `z-button` for the tab strip buttons and style them with
`tabButtonVariants` directly. Note the tabs component is zard/CLI-managed
(`components.json`) — prefer fixing on the button side or upstreaming.

Workaround used by tests meanwhile: select tab buttons via `nav[role="tablist"] button`
(see `workspace-detail.page.spec.ts`).
