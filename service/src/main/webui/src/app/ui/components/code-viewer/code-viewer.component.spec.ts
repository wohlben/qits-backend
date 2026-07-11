import { TestBed } from '@angular/core/testing';

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';

import { CodeViewerComponent, type LineRange } from './code-viewer.component';

const CONTENT = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');

describe('CodeViewerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeViewerComponent],
    }).compileComponents();
  });

  afterEach(() => vi.useRealTimers());

  function createComponent(inputs: {
    path: string;
    content: string | null;
    binary?: boolean;
  }) {
    const fixture = TestBed.createComponent(CodeViewerComponent);
    fixture.componentRef.setInput('path', inputs.path);
    fixture.componentRef.setInput('content', inputs.content);
    fixture.componentRef.setInput('binary', inputs.binary ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a placeholder for a binary file and mounts no editor', () => {
    const fixture = createComponent({ path: 'blob.bin', content: null, binary: true });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Binary file');
    expect(fixture.nativeElement.querySelector('.cm-editor')).toBeNull();
  });

  it('shows a placeholder when there is no content', () => {
    const fixture = createComponent({ path: 'empty.txt', content: null });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No content');
    expect(fixture.nativeElement.querySelector('.cm-editor')).toBeNull();
  });

  describe('selection lifecycle', () => {
    function mountWithSelection() {
      // Fake only the timer APIs: the queueMicrotask emit deferral must stay real (drained with
      // an awaited Promise.resolve()).
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const fixture = createComponent({ path: 'a.ts', content: CONTENT });
      const emits: LineRange[] = [];
      fixture.componentInstance.selectRange.subscribe((r) => emits.push(r));
      const dom = (fixture.nativeElement as HTMLElement).querySelector('.cm-editor');
      const view = EditorView.findFromDOM(dom as HTMLElement);
      if (!view) {
        throw new Error('EditorView did not mount');
      }
      return { fixture, emits, view };
    }

    /** Dispatches a selection transaction spanning the given 1-based lines — a `selectionSet` update. */
    function selectLines(view: EditorView, from: number, to: number): void {
      view.dispatch({
        selection: EditorSelection.range(
          view.state.doc.line(from).from,
          view.state.doc.line(to).to,
        ),
      });
    }

    function mouseup(): void {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }

    it('emits once on mouseup with the final range after several selection updates', async () => {
      const { emits, view } = mountWithSelection();

      selectLines(view, 2, 3); // intermediate states, as a drag would produce
      selectLines(view, 2, 5);
      selectLines(view, 2, 8);
      mouseup();
      await Promise.resolve(); // drain the queueMicrotask deferral

      expect(emits).toEqual([{ startLine: 2, endLine: 8 }]);

      vi.advanceTimersByTime(400); // the canceled debounce must not double-emit
      await Promise.resolve();
      expect(emits).toHaveLength(1);
    });

    it('emits once after the quiet period for keyboard selection growth', async () => {
      const { emits, view } = mountWithSelection();

      selectLines(view, 4, 4);
      vi.advanceTimersByTime(200);
      selectLines(view, 4, 6); // resets the debounce
      vi.advanceTimersByTime(399);
      await Promise.resolve();
      expect(emits).toEqual([]);

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(emits).toEqual([{ startLine: 4, endLine: 6 }]);
    });

    it('emits nothing for a plain cursor click', async () => {
      const { emits, view } = mountWithSelection();

      view.dispatch({ selection: EditorSelection.cursor(0) });
      mouseup();
      vi.advanceTimersByTime(400);
      await Promise.resolve();

      expect(emits).toEqual([]);
    });

    it('does not emit a stale range when a selection is followed by a collapsing click', async () => {
      const { emits, view } = mountWithSelection();

      selectLines(view, 2, 5);
      view.dispatch({ selection: EditorSelection.cursor(0) }); // the click's collapse
      mouseup();
      vi.advanceTimersByTime(400);
      await Promise.resolve();

      expect(emits).toEqual([]);
    });

    it('removes its document listener on destroy — a later mouseup emits nothing', async () => {
      const { fixture, emits, view } = mountWithSelection();

      selectLines(view, 2, 5);
      fixture.destroy();
      mouseup();
      await Promise.resolve();

      expect(emits).toEqual([]);
    });
  });
});
