import { DOCUMENT } from '@angular/common';
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
  drawSelection,
  EditorView,
  lineNumbers,
  type ViewUpdate,
} from '@codemirror/view';

/** A 1-based, inclusive line range the user selected in the viewer. */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** Quiet period after the last keyboard-driven selection change before the range is emitted. */
const SELECTION_DEBOUNCE_MS = 400;

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

/**
 * Pick-mode extensions: CodeMirror-drawn selection feedback plus native text selection
 * suppressed (the gesture reads as picking lines, not selecting copyable text — CodeMirror's
 * own mouse selection computes positions itself, so the gesture machinery keeps working).
 * Empty when off: selection is fully native.
 */
function pickExtensions(on: boolean): Extension {
  return on ? [drawSelection(), EditorView.theme({ '.cm-content': { userSelect: 'none' } })] : [];
}

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
 * highlighting (grammar chosen from the filename) and paints already-collected ranges (the
 * `highlights` input) so referenced code stays visibly marked. While `pickMode` is armed the user
 * can pick a line range — emitted via {@link selectRange} once per finalized gesture (mouseup for
 * pointer drags, a quiet period for keyboard selections) — with native text selection suppressed;
 * with it off (the default) selection is plain native text selection and nothing is emitted. No
 * services/API/routing: theme is passed in via `isDark` to keep this in the `ui/` layer. Editing
 * is disabled; this is a viewer, not an editor.
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
  /** When set, the viewer scrolls this 1-based line into view (e.g. a daemon event's anchor). */
  readonly scrollToLine = input<number | null>(null);
  /**
   * When true the editor grows to fit its content instead of filling its parent — use it for short
   * embedded snippets (e.g. a file's frontmatter) that should be only as tall as the text.
   */
  readonly fit = input(false);
  /** Arms the line-pick gesture; off (default) leaves selection fully native and emits nothing. */
  readonly pickMode = input(false);

  readonly selectRange = output<LineRange>();

  private readonly hostRef = viewChild<ElementRef<HTMLElement>>('host');
  private readonly document = inject(DOCUMENT);
  private readonly languageCompartment = new Compartment();
  private readonly pickCompartment = new Compartment();
  private view?: EditorView;

  private pendingRange: LineRange | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** True between a mousedown inside the editor and the next document mouseup. */
  private pointerSelecting = false;

  constructor() {
    // Pointer drags can end outside the editor, so the flush listens on the document; registered
    // once for the component's lifetime — it is a no-op when no selection is pending.
    this.document.addEventListener('mouseup', this.onDocumentMouseUp);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('mouseup', this.onDocumentMouseUp);
      this.destroyView();
    });

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

    // Scroll to a newly requested anchor line without rebuilding (rebuild also applies it).
    effect(() => {
      this.scrollToLine();
      if (this.view) {
        this.applyScrollToLine();
      }
    });

    // Swap the pick extensions in place — toggling must not tear down the editor — and abandon
    // any half-finished gesture when the picker disarms so a later mouseup can't emit it.
    effect(() => {
      const on = this.pickMode();
      if (this.view) {
        this.view.dispatch({ effects: this.pickCompartment.reconfigure(pickExtensions(on)) });
      }
      if (!on) {
        this.clearPending();
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
    this.applyScrollToLine();
    void this.loadLanguage(path);
  }

  private applyScrollToLine(): void {
    const line = this.scrollToLine();
    if (!this.view || line === null) {
      return;
    }
    const doc = this.view.state.doc;
    if (line < 1 || line > doc.lines) {
      return;
    }
    this.view.dispatch({
      effects: EditorView.scrollIntoView(doc.line(line).from, { y: 'center' }),
    });
  }

  private extensions(dark: boolean): Extension[] {
    return [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      highlightField,
      this.languageCompartment.of([]),
      // extensions() only runs inside the rebuild effect's untracked(), so this read doesn't
      // make pickMode a rebuild trigger — toggling reconfigures the compartment in place.
      this.pickCompartment.of(pickExtensions(this.pickMode())),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
      EditorView.domEventHandlers({
        mousedown: () => {
          if (!this.pickMode()) {
            return; // picker disarmed: nothing pending, nothing to suspend
          }
          // A pointer gesture finalizes on mouseup, not after a quiet period — suspend the
          // keyboard debounce until the drag ends. Don't return true: CodeMirror still handles
          // the selection itself.
          this.pointerSelecting = true;
          this.cancelDebounce();
        },
      }),
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
    if (!update.selectionSet || !this.pickMode()) {
      return;
    }
    const sel = update.state.selection.main;
    if (sel.empty) {
      // A plain click collapses the selection — abandon any pending range so the following
      // mouseup (or a still-running debounce) doesn't emit a stale gesture.
      this.clearPending();
      return;
    }
    this.pendingRange = {
      startLine: update.state.doc.lineAt(sel.from).number,
      endLine: update.state.doc.lineAt(sel.to).number,
    };
    // Keyboard gestures (shift+arrows) have no mouseup: flush after a quiet period. During a
    // pointer drag the mouseup is the finalizer, so no timer runs.
    this.cancelDebounce();
    if (!this.pointerSelecting) {
      this.debounceTimer = setTimeout(() => this.flushPending(), SELECTION_DEBOUNCE_MS);
    }
  }

  private readonly onDocumentMouseUp = (): void => {
    this.pointerSelecting = false;
    this.flushPending();
  };

  /** Emits the pending range — one flush per gesture, whichever seam (mouseup, timer) fires first. */
  private flushPending(): void {
    this.cancelDebounce();
    const range = this.pendingRange;
    if (!range) {
      return; // mouseup with nothing pending (plain click, click elsewhere on the page, …)
    }
    this.pendingRange = null;
    // Defer so we never emit (and trigger a downstream dispatch) mid-update.
    queueMicrotask(() => this.selectRange.emit(range));
  }

  private clearPending(): void {
    this.pendingRange = null;
    this.cancelDebounce();
  }

  private cancelDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private destroyView(): void {
    // A rebuild or destroy mid-gesture must never emit a range computed against the old document.
    this.clearPending();
    this.pointerSelecting = false;
    this.view?.destroy();
    this.view = undefined;
  }
}
