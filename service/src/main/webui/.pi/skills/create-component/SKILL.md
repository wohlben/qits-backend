---
name: create-component
description: Guidelines for adding new Angular components to the project. Use whenever a new UI element or feature component needs to be created. Checks Zard UI coverage first, then falls back to custom component generation.
---

# Create Component

Before creating a new component, verify that the use case is not already sufficiently covered by an existing solution.

## 1. Check Zard UI

This project uses [Zard UI](https://zardui.com) as its primary component library. It is already initialized and configured. Do **not** reinstall or reinitialize it.

When you need a component that has **not** been added to the project yet, check the available Zard UI components below. If a suitable one exists, open its documentation link (from the list below) and review the integration instructions **before** installing.

> **Important:** The CLI install is sometimes not sufficient on its own. The docs may require manual steps such as importing additional modules, configuring providers, or wiring up CDK overlays.

Only run the install command for components that have not been previously added:

```bash
npx zard-cli add <component-name>
```

> Check `src/app/shared/components` (or the directory configured in `components.json`) to see what is already present.

### Available Zard UI Components

#### Form & Input

- [Button](https://zardui.com/docs/components/button): Button component for Angular applications.
- [Input](https://zardui.com/docs/components/input): Input component for Angular applications.
- [Checkbox](https://zardui.com/docs/components/checkbox): Checkbox component for Angular applications.
- [Radio](https://zardui.com/docs/components/radio): Radio component for Angular applications.
- [Select](https://zardui.com/docs/components/select): Select component for Angular applications.
- [Switch](https://zardui.com/docs/components/switch): Switch component for Angular applications.
- [Slider](https://zardui.com/docs/components/slider): Slider component for Angular applications.
- [Calendar](https://zardui.com/docs/components/calendar): Calendar component for Angular applications.
- [Date Picker](https://zardui.com/docs/components/date-picker): Date Picker component for Angular applications.
- [Combobox](https://zardui.com/docs/components/combobox): Combobox component for Angular applications.
- [Form](https://zardui.com/docs/components/form): Form component for Angular applications.
- [Input Group](https://zardui.com/docs/components/input-group): Input Group component for Angular applications.

#### Layout & Navigation

- [Accordion](https://zardui.com/docs/components/accordion): Accordion component for Angular applications.
- [Breadcrumb](https://zardui.com/docs/components/breadcrumb): Breadcrumb component for Angular applications.
- [Menu](https://zardui.com/docs/components/menu): Menu component for Angular applications.
- [Tabs](https://zardui.com/docs/components/tabs): Tabs component for Angular applications.
- [Divider](https://zardui.com/docs/components/divider): Divider component for Angular applications.
- [Resizable](https://zardui.com/docs/components/resizable): Resizable component for Angular applications.

#### Overlays & Dialogs

- [Dialog](https://zardui.com/docs/components/dialog): Dialog component for Angular applications.
- [Alert Dialog](https://zardui.com/docs/components/alert-dialog): Alert Dialog component for Angular applications.
- [Sheet](https://zardui.com/docs/components/sheet): Sheet component for Angular applications.
- [Popover](https://zardui.com/docs/components/popover): Popover component for Angular applications.
- [Tooltip](https://zardui.com/docs/components/tooltip): Tooltip component for Angular applications.
- [Dropdown](https://zardui.com/docs/components/dropdown): Dropdown component for Angular applications.
- [Command](https://zardui.com/docs/components/command): Command component for Angular applications.

#### Feedback & Status

- [Alert](https://zardui.com/docs/components/alert): Alert component for Angular applications.
- [Toast](https://zardui.com/docs/components/toast): Toast component for Angular applications.
- [Progress Bar](https://zardui.com/docs/components/progress-bar): Progress Bar component for Angular applications.
- [Loader](https://zardui.com/docs/components/loader): Loader component for Angular applications.
- [Skeleton](https://zardui.com/docs/components/skeleton): Skeleton component for Angular applications.
- [Badge](https://zardui.com/docs/components/badge): Badge component for Angular applications.
- [Empty](https://zardui.com/docs/components/empty): Empty component for Angular applications.

#### Display & Media

- [Avatar](https://zardui.com/docs/components/avatar): Avatar component for Angular applications.
- [Card](https://zardui.com/docs/components/card): Card component for Angular applications.
- [Table](https://zardui.com/docs/components/table): Table component for Angular applications.
- [Icon](https://zardui.com/docs/components/icon): Icon component for Angular applications.

#### Misc

- [Toggle](https://zardui.com/docs/components/toggle): Toggle component for Angular applications.
- [Toggle Group](https://zardui.com/docs/components/toggle-group): Toggle Group component for Angular applications.
- [Segmented](https://zardui.com/docs/components/segmented): Segmented component for Angular applications.
- [Pagination](https://zardui.com/docs/components/pagination): Pagination component for Angular applications.

## 2. Check Existing Project Components

If Zard UI does not cover the use case, search the codebase for existing custom components that might already handle a similar need.

## 3. Create a New Custom Component

If the use case is not sufficiently covered by Zard UI or an existing custom component, generate a new one with the Angular CLI:

```bash
ng generate component <path>
```

### Directory Conventions

Use the following aliases and folder structure when deciding where to place a new component:

- **Dumb / Presentational components** (pure display, no data fetching, no side effects)  
  Place under `$ui/components/<domain>/`
  - Example: `$ui/components/issues/issue-card.component.ts`
  - Example: `$ui/components/issues/issue-list.component.ts`

- **Presentational forms** (collect input, emit data, no API calls)  
  Place under `$ui/forms/<domain>/`
  - Example: `$ui/forms/project/project-form.component.ts`

- **Domain-specific inputs** (label + custom control + error display for a specific field)  
  Place under `$ui/inputs/<domain>/`
  - Example: `$ui/inputs/projects/project-description-input.component.ts`

- **Smart / Container components** (manage state, execute REST requests, handle forms, orchestrate child components)  
  Place under `$pattern/<domain>/`
  - Example: `$pattern/issues/issue-create-form.component.ts`

> The aliases map as follows:
> - `$ui/*` → `src/app/ui/*`
> - `$pattern/*` → `src/app/pattern/*`

### Component Standards

Follow all rules defined in `AGENTS.md`, including but not limited to:
- Standalone components (do **not** set `standalone: true` in the decorator).
- Signal-based inputs and outputs.
- `ChangeDetectionStrategy.OnPush`.
- Native control flow (`@if`, `@for`, `@switch`).
- `inject()` for dependency injection.
- WCAG AA accessibility compliance.
