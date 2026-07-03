import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';

import {
  defaultHighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';

/** A 1-based, inclusive line range the user selected in the viewer. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

const setHighlights = StateEffect.define<LineRange[]>();

/** A CodeMirror StateField that paints the given line ranges with the `.cm-refHighlight` class. */
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlights)) {
        return buildHighlights(tr.state, e.value);
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildHighlights(state: EditorState, ranges: LineRange[]): DecorationSet {
  const lineDeco = Decoration.line({ class: 'cm-refHighlight' });
  const marks = [];
  for (const range of ranges) {
    const from = Math.max(1, range.startLine);
    const to = Math.min(state.doc.lines, range.endLine);
    for (let ln = from; ln <= to; ln++) {
      marks.push(lineDeco.range(state.doc.line(ln).from));
    }
  }
  return Decoration.set(marks, true);
}

/**
 * Presentational, read-only code viewer built on CodeMirror 6. It shows a file's text with syntax
 * highlighting (grammar chosen from the filename), lets the user select a line range — emitted via
 * {@link selectRange} — and paints already-collected ranges (the `highlights` input) so referenced
 * code stays visibly marked. No services/API/routing: theme is passed in via `isDark` to keep this
 * in the `ui/` layer. Editing is disabled; this is a viewer, not an editor.
 */
@Component({
  selector: 'app-code-viewer',
  template: `
    @if (binary()) {
      <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
        Binary file — not shown.
      </div>
    } @else if (content() === null) {
      <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
        No content.
      </div>
    } @else {
      <div
        #host
        class="min-h-0 overflow-hidden rounded-md border text-sm"
        [class.h-full]="!fit()"
      ></div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeViewerComponent {
  readonly path = input.required<string>();
  readonly content = input.required<string | null>();
  readonly binary = input(false);
  readonly isDark = input(false);
  readonly highlights = input<LineRange[]>([]);
  /**
   * When true the editor grows to fit its content instead of filling its parent — use it for short
   * embedded snippets (e.g. a file's frontmatter) that should be only as tall as the text.
   */
  readonly fit = input(false);

  readonly selectRange = output<LineRange>();

  private readonly hostRef = viewChild<ElementRef<HTMLElement>>('host');
  private readonly languageCompartment = new Compartment();
  private view?: EditorView;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyView());

    // Rebuild the editor whenever the file, its content, or the theme changes. Highlights are read
    // untracked so collecting a reference doesn't tear down and rebuild the whole view.
    effect(() => {
      const host = this.hostRef()?.nativeElement;
      const content = this.content();
      const dark = this.isDark();
      const path = this.path();
      // Track binary and fit too, so toggling either re-evaluates.
      this.binary();
      this.fit();

      untracked(() => this.rebuild(host, path, content, dark));
    });

    // Re-paint highlights in place when the collected ranges change.
    effect(() => {
      const ranges = this.highlights();
      if (this.view) {
        this.view.dispatch({ effects: setHighlights.of(ranges) });
      }
    });
  }

  private rebuild(
    host: HTMLElement | undefined,
    path: string,
    content: string | null,
    dark: boolean,
  ): void {
    this.destroyView();
    if (!host || content === null || this.binary()) {
      return;
    }

    const state = EditorState.create({
      doc: content,
      extensions: this.extensions(dark),
    });
    this.view = new EditorView({ state, parent: host });
    this.view.dispatch({ effects: setHighlights.of(this.highlights()) });
    void this.loadLanguage(path);
  }

  private extensions(dark: boolean): Extension[] {
    return [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightField,
      this.languageCompartment.of([]),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
      EditorView.theme({
        // Fill the parent by default; in fit mode grow to content instead so the viewer is only as
        // tall as its text (capped, so an unexpectedly huge snippet still scrolls rather than sprawls).
        '&': this.fit() ? { maxHeight: '20rem' } : { height: '100%' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-refHighlight': { backgroundColor: 'rgba(250, 204, 21, 0.18)' },
      }),
      dark ? oneDark : [],
    ];
  }

  /** Loads the grammar for the file (by extension) and swaps it in without rebuilding the view. */
  private async loadLanguage(path: string): Promise<void> {
    const desc = LanguageDescription.matchFilename(languages, path);
    if (!desc) {
      return;
    }
    const support = await desc.load();
    // The view may have been rebuilt or destroyed while the grammar loaded.
    if (!this.view || this.path() !== path) {
      return;
    }
    this.view.dispatch({ effects: this.languageCompartment.reconfigure(support) });
  }

  private onUpdate(update: ViewUpdate): void {
    if (!update.selectionSet) {
      return;
    }
    const sel = update.state.selection.main;
    if (sel.empty) {
      return; // a plain cursor click is not a range selection
    }
    const startLine = update.state.doc.lineAt(sel.from).number;
    const endLine = update.state.doc.lineAt(sel.to).number;
    // Defer so we never emit (and trigger a downstream dispatch) mid-update.
    queueMicrotask(() => this.selectRange.emit({ startLine, endLine }));
  }

  private destroyView(): void {
    this.view?.destroy();
    this.view = undefined;
  }
}
