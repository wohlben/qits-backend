---
name: zardui-components
description: >
  Explore, install, and use ZardUI Angular components in this project.
  ZardUI is a shadcn/ui-inspired Angular component library (signals, OnPush,
  Tailwind v4, CVA). Components are CLI-managed — do not edit by hand.
  Use this skill when the user asks to add a UI component, explore available
  ZardUI components, understand a component's API/variants, or integrate
  ZardUI into Angular patterns/components.
---

# ZardUI Components Skill

## What is ZardUI?

ZardUI (`zard/ui`) is an open-source Angular component library inspired by shadcn/ui.
- **Signal-based inputs** with `OnPush` change detection
- **TailwindCSS v4** for styling
- **Class Variance Authority (CVA)** for type-safe style variants
- **Angular 19+**, SSR-compatible, zoneless-ready
- Components are **copied into your codebase** (not an npm dependency), so they are fully customizable but managed by the CLI

**Project conventions** (from `AGENTS.md`):
- ZardUI components live under `src/app/components/zardui/`
- Path alias: `@/components/zardui/*`
- **Do not edit zardui components by hand** — use `npx zard-cli add <name>`

---

## Discovering Available Components

### Quick list
Run the CLI with no arguments inside the webui directory to see interactive selection:

```bash
cd qits/service/src/main/webui
npx zard-cli@latest add
```

### Full registry
The following components are available as of the latest registry:

**Form & Input**
- `button`, `input`, `checkbox`, `radio`, `select`, `switch`, `slider`, `calendar`, `date-picker`, `combobox`, `form`, `input-group`

**Layout & Navigation**
- `accordion`, `breadcrumb`, `menu`, `tabs`, `divider`, `resizable`, `layout`

**Overlays & Dialogs**
- `dialog`, `alert-dialog`, `sheet`, `popover`, `tooltip`, `dropdown`, `command`

**Feedback & Status**
- `alert`, `toast`, `progress-bar`, `loader`, `skeleton`, `badge`, `empty`

**Display & Media**
- `avatar`, `card`, `table`, `icon`

**Misc**
- `toggle`, `toggle-group`, `segmented`, `pagination`, `carousel`, `tree`, `button-group`, `kbd`

**Infrastructure**
- `core` (required internals), `utils` (mergeClasses, etc.), `dark-mode`

### Online docs
Each component has dedicated docs with installation, examples, and API tables:
```
https://zardui.com/docs/components/<kebab-name>
```
Examples:
- `button` → https://zardui.com/docs/components/button
- `alert-dialog` → https://zardui.com/docs/components/alert-dialog
- `input-group` → https://zardui.com/docs/components/input-group

---

## Adding a Component

### Basic usage
```bash
cd qits/service/src/main/webui
npx zard-cli@latest add <component-name>
```

Examples:
```bash
npx zard-cli@latest add button
npx zard-cli@latest add card dialog
npx zard-cli@latest add --all          # add every component
```

### Important flags
| Flag | Meaning |
|------|---------|
| `-y, --yes` | Skip confirmation prompts |
| `-o, --overwrite` | Overwrite existing files |
| `-a, --all` | Install all available components |
| `-p, --path <path>` | Custom target subdirectory |

### How the CLI works
1. Reads `components.json` in the webui root to know where to place files
2. Fetches component source + its **registry dependencies** (other zardui components it needs)
3. Installs any **npm dependencies** the component requires
4. Writes files into `src/app/components/zardui/<component>/`

### Understanding dependencies
- **`registryDependencies`** — other ZardUI components automatically pulled in (e.g. `card` depends on `button`)
- **`dependencies`** — npm packages automatically installed (e.g. `toast` needs `ngx-sonner`, `carousel` needs `embla-carousel-angular`)

You do **not** need to manually install these; the CLI resolves them.

### components.json configuration
The project already has this configured at `qits/service/src/main/webui/components.json`:
```json
{
  "$schema": "https://zardui.com/schema.json",
  "tailwind": { "css": "src/styles.scss" },
  "aliases": {
    "components": "@/components/zardui",
    "utils": "@/lib/utils"
  },
  "appConfig": "src/app/app.config.ts",
  "indexHtml": "src/index.html"
}
```

The `aliases.components` path is where CLI drops components. The path alias `@/components/zardui` maps to `src/app/components/zardui/` via `tsconfig.json`.

---

## Component File Structure

After installation, a simple component (e.g. `button`) looks like:

```
src/app/components/zardui/button/
├── button.component.ts      # Angular component/directive
├── button.variants.ts       # CVA style variants + exported types
└── index.ts                 # Barrel export
```

More complex components may include:
- `.service.ts` — imperative API (dialog, sheet, toast)
- `.directive.ts` — attribute directive instead of component (input, menu)
- `.imports.ts` — shared imports array
- `.types.ts` / `.utils.ts` — helper types and functions
- sub-components (e.g. `accordion-item.component.ts`, `dialog-ref.ts`)

### Pattern: Component vs Directive
ZardUI uses **both**:
- **Component** (`@Component`) — standalone, selector like `z-button` or `[z-button]`
- **Directive** (`@Directive`) — applied to native elements, e.g. `input[z-input]`, `textarea[z-input]`

Check the `selector` in the source to know how to use it.

---

## Using a Component in the Project

### 1. Import from the alias path
```typescript
import { ZardButtonComponent } from '@/components/zardui/button';
```

### 2. Add to your component's `imports` array
```typescript
@Component({
  selector: 'app-my-pattern',
  imports: [ZardButtonComponent],
  template: `...`,
})
export class MyPatternComponent {}
```

### 3. Use in template
```html
<!-- Component selector -->
<z-button zType="destructive" zSize="sm" (click)="save()">Save</z-button>

<!-- Directive selector on native element -->
<input z-input zSize="sm" placeholder="Enter name" />
```

### Variant types
Variants are exported from the `*.variants.ts` file and used as input types:
```typescript
import { type ZardButtonTypeVariants, type ZardButtonSizeVariants } from '@/components/zardui/button';
```

Common variant names across components:
- `zType` — visual style (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`)
- `zSize` — sizing (`default`, `xs`, `sm`, `lg`, `icon`, etc.)
- `zShape` — border radius (`default`, `circle`, `square`)
- `zStatus` — validation state (`error`, `warning`, `success`)
- `zDisabled`, `zLoading`, `zFull` — boolean state flags

---

## Styling Utilities

ZardUI relies on `mergeClasses` (a `twMerge` + `clsx` wrapper):
```typescript
import { mergeClasses } from '@/lib/utils/merge-classes';
```

This is used inside every component to merge CVA-generated base classes with any `class` input the consumer passes.

If you need to add a custom `class` to a ZardUI component, just use its `class` input:
```html
<z-button class="my-custom-class">Click</z-button>
```

---

## Researching an Unfamiliar Component

When you need to integrate a component you haven't used before:

1. **Read the online docs**
   ```
   https://zardui.com/docs/components/<name>
   ```
   Docs include installation, live examples, and an API reference table.

2. **Read the installed source**
   After adding the component, inspect its files:
   ```
   qits/service/src/main/webui/src/app/components/zardui/<name>/
   ```
   - `*.component.ts` or `*.directive.ts` → check `selector`, `inputs`, `outputs`, `exportAs`
   - `*.variants.ts` → check available variant options
   - `index.ts` → check public exports

3. **Check for services**
   Components like `dialog`, `sheet`, `toast`, `alert-dialog` are opened via a service rather than template tags. Look for `ZardDialogService`, `ZardSheetService`, etc.

4. **Look at registryDependencies**
   If a component pulls in other ZardUI components automatically, you may use those sub-components directly too.

---

## Rules & Warnings

- **Never manually edit files under `src/app/components/zardui/`**. If you need changes, re-add with `--overwrite` or create a wrapper in `components/ui/`.
- **Always use the path alias** (`@/components/zardui/...`) for imports, not relative paths.
- **Don't commit build artifacts** (`target/`, `dist/`, `node_modules/`) — already covered by `.gitignore`.
- If a component needs npm dependencies the CLI missed, install them manually in the `webui` directory.

---

## Common Commands Cheat Sheet

```bash
# Navigate to the Angular app
cd qits/service/src/main/webui

# Add one component
npx zard-cli@latest add button

# Add multiple
npx zard-cli@latest add card dialog input

# Re-add / update a component (overwrite local changes)
npx zard-cli@latest add button --overwrite

# Add all components
npx zard-cli@latest add --all
```

---

## External References

- **Docs home**: https://zardui.com/docs/introduction
- **Component list**: https://zardui.com/docs/components
- **CLI docs**: https://zardui.com/docs/cli
- **LLMs overview**: https://zardui.com/llms.txt
- **GitHub**: https://github.com/zard-ui/zardui
