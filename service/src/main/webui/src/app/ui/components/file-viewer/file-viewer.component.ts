import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCode, lucideEye } from '@ng-icons/lucide';

import { ZardButtonComponent } from '@/shared/components/button';
import {
  CodeViewerComponent,
  type LineRange,
} from '@/ui/components/code-viewer/code-viewer.component';
import { MarkdownFileRendererComponent } from './markdown-file-renderer.component';
import { findRenderer } from './renderers';

export type FileViewMode = 'rendered' | 'source';

/**
 * Presentational host for a file's content: files whose type has a {@link findRenderer smart
 * renderer} get a rendered view plus a Preview/Code toggle; everything else falls straight
 * through to the plain {@link CodeViewerComponent} exactly as before (including its binary and
 * no-content placeholders). The component is *controlled*: the parent owns the `mode` input and
 * reacts to {@link modeChange} — this host is destroyed on every file switch (it lives inside
 * the parent's query state branches), so it can't remember the choice itself.
 */
@Component({
  selector: 'app-file-viewer',
  imports: [CodeViewerComponent, MarkdownFileRendererComponent, ZardButtonComponent, NgIcon],
  providers: [provideIcons({ lucideEye, lucideCode })],
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    @if (showToggle()) {
      <div class="mb-2 flex shrink-0 items-center justify-end">
        <div class="inline-flex items-center gap-0.5 rounded-md border p-0.5">
          <button
            z-button
            [zType]="effectiveMode() === 'rendered' ? 'secondary' : 'ghost'"
            zSize="sm"
            [attr.aria-pressed]="effectiveMode() === 'rendered'"
            (click)="modeChange.emit('rendered')"
          >
            <ng-icon name="lucideEye" class="mr-1 size-4!" />
            Preview
          </button>
          <button
            z-button
            [zType]="effectiveMode() === 'source' ? 'secondary' : 'ghost'"
            zSize="sm"
            [attr.aria-pressed]="effectiveMode() === 'source'"
            (click)="modeChange.emit('source')"
          >
            <ng-icon name="lucideCode" class="mr-1 size-4!" />
            Code
          </button>
        </div>
      </div>
    }
    <div class="min-h-0 flex-1">
      @if (effectiveMode() === 'rendered') {
        <!-- One @if branch per renderer instead of NgComponentOutlet: the renderer needs a typed
             output; switch to an outlet once a second renderer settles the shared contract. -->
        <div class="h-full overflow-auto rounded-md border">
          <app-markdown-file-renderer
            [content]="content()!"
            [path]="path()"
            [isDark]="isDark()"
            (openLink)="openPath.emit($event)"
          />
        </div>
      } @else {
        <app-code-viewer
          [path]="path()"
          [content]="content()"
          [binary]="binary()"
          [isDark]="isDark()"
          [highlights]="highlights()"
          [scrollToLine]="scrollToLine()"
          (selectRange)="selectRange.emit($event)"
        />
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileViewerComponent {
  readonly path = input.required<string>();
  readonly content = input.required<string | null>();
  readonly binary = input(false);
  readonly isDark = input(false);
  readonly highlights = input<LineRange[]>([]);
  /** Passed through to the source view: scroll this 1-based line into view. */
  readonly scrollToLine = input<number | null>(null);
  /** Controlled by the parent — this host never stores the mode itself. */
  readonly mode = input<FileViewMode>('rendered');

  readonly modeChange = output<FileViewMode>();
  /** Re-emitted from the source view's line-range selection. */
  readonly selectRange = output<LineRange>();
  /** A relative link inside a rendered view, resolved to a repo-relative path to open. */
  readonly openPath = output<string>();

  private readonly renderer = computed(() => findRenderer(this.path()));

  protected readonly showToggle = computed(
    () => this.renderer() !== undefined && !this.binary() && this.content() !== null,
  );

  /** `mode` only applies when a renderer matches; everything else is always source. */
  protected readonly effectiveMode = computed<FileViewMode>(() =>
    this.showToggle() ? this.mode() : 'source',
  );
}
