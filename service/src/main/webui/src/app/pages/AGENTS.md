# Page Component Conventions

Every page component in this directory MUST use `<app-page-layout>` to guarantee a consistent page structure.

## API

| Slot / Input | Purpose |
|--------------|---------|
| `pageTitle` | Page heading and optional subtitle. Left-aligned, grows to fill header space. |
| `pageActions` | Action buttons (create, delete, save, etc.). Right-aligned, rendered as a `gap-2` flex row. |
| Default `ng-content` | Main body content below the header. |
| `[hasActions]` | Set to `false` when a page has no action buttons to hide the actions container. |

## Example

```ts
import { PageLayoutComponent } from '@/layout/page-layout/page-layout.component';

@Component({
  selector: 'app-project-list-page',
  imports: [PageLayoutComponent, ZardButtonComponent],
  template: `
    <app-page-layout>
      <div pageTitle>
        <h1 class="text-2xl font-bold">Projects</h1>
        <p class="text-sm text-muted-foreground">Manage your projects</p>
      </div>

      <div pageActions>
        <z-button zType="primary" (click)="create()">Create project</z-button>
      </div>

      <app-project-list />
    </app-page-layout>
  `,
})
export class ProjectListPage {}
```

## Rules

- The `pageTitle` slot MUST contain exactly one `<h1>` for the page title.
- Action buttons MUST live inside `pageActions`, never inline in the body content.
- If a page has no actions, set `[hasActions]="false"` instead of leaving the slot empty.
- Do not add custom headers inside the default content slot — use the `pageTitle` slot instead.
