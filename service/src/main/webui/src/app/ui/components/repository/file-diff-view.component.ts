import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Diff2HtmlUI } from 'diff2html/lib/ui/js/diff2html-ui';
import { ColorSchemeType } from 'diff2html/lib/types';

import { ZardDarkMode, EDarkModes } from '@/shared/services/dark-mode';
import { EmptyStateComponent } from '@/ui/components/empty-state/empty-state.component';

/**
 * Renders a single file's unified diff as a syntax-highlighted, line-by-line view via
 * `diff2html` (which bundles highlight.js). Drawing touches the real DOM, so it runs in an
 * `afterRenderEffect` that re-draws whenever the diff or the app theme changes; the diff's
 * color scheme follows {@link ZardDarkMode}. An empty/whitespace diff (binary or pure
 * rename) falls back to an empty state.
 */
@Component({
  selector: 'app-file-diff-view',
  imports: [EmptyStateComponent],
  template: `
    @if (hasDiff()) {
      <div #target class="commit-diff text-sm"></div>
    } @else {
      <app-empty-state>
        <span title>No textual changes</span>
        <span description>{{ emptyDescription() }}</span>
      </app-empty-state>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileDiffViewComponent {
  readonly diff = input<string>('');
  readonly path = input<string>('');

  private readonly darkMode = inject(ZardDarkMode);
  private readonly target = viewChild<ElementRef<HTMLElement>>('target');

  readonly hasDiff = computed(() => !!this.diff()?.trim());

  readonly emptyDescription = computed(() =>
    this.path()
      ? `${this.path()} has no line changes (binary or rename only).`
      : 'Select a file from the tree to view its diff.',
  );

  constructor() {
    afterRenderEffect(() => {
      const element = this.target()?.nativeElement;
      const diff = this.diff();
      if (!element || !diff?.trim()) return;

      const ui = new Diff2HtmlUI(element, diff, {
        drawFileList: false,
        outputFormat: 'line-by-line',
        matching: 'lines',
        highlight: true,
        colorScheme:
          this.darkMode.themeMode() === EDarkModes.DARK
            ? ColorSchemeType.DARK
            : ColorSchemeType.LIGHT,
      });
      ui.draw();
      ui.highlightCode();
    });
  }
}
