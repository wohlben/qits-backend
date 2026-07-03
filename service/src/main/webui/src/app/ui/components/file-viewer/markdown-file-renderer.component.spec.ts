import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { MarkdownFileRendererComponent } from './markdown-file-renderer.component';

const CONTENT = [
  '[relative](./other.md)',
  '[up](../src/foo.ts)',
  '[external](https://example.com/page)',
  '[anchor](#section)',
  '[mail](mailto:a@b.c)',
  'plain text',
].join('\n\n');

describe('MarkdownFileRendererComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownFileRendererComponent],
    }).compileComponents();
  });

  function createComponent(): ComponentFixture<MarkdownFileRendererComponent> {
    const fixture = TestBed.createComponent(MarkdownFileRendererComponent);
    fixture.componentRef.setInput('content', CONTENT);
    fixture.componentRef.setInput('path', 'docs/guide/intro.md');
    fixture.detectChanges();
    return fixture;
  }

  function clickLink(
    fixture: ComponentFixture<MarkdownFileRendererComponent>,
    text: string,
  ): MouseEvent {
    const anchors = [...(fixture.nativeElement as HTMLElement).querySelectorAll('a')];
    const anchor = anchors.find((a) => a.textContent === text);
    if (!anchor) {
      throw new Error(`No link with text "${text}"`);
    }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(event);
    return event;
  }

  it('resolves a relative link against the file’s directory and emits it', () => {
    const fixture = createComponent();
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    const event = clickLink(fixture, 'relative');

    expect(emitted).toEqual(['docs/guide/other.md']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('resolves ../ links upwards before emitting', () => {
    const fixture = createComponent();
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    clickLink(fixture, 'up');

    expect(emitted).toEqual(['docs/src/foo.ts']);
  });

  it('opens external links in a new tab instead of navigating', () => {
    const fixture = createComponent();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    const event = clickLink(fixture, 'external');

    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener');
    expect(event.defaultPrevented).toBe(true);
    expect(emitted).toEqual([]);
    open.mockRestore();
  });

  it('swallows anchor-only links (no heading ids yet)', () => {
    const fixture = createComponent();
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    const event = clickLink(fixture, 'anchor');

    expect(event.defaultPrevented).toBe(true);
    expect(emitted).toEqual([]);
  });

  it('leaves mailto links to the browser default', () => {
    const fixture = createComponent();
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    const event = clickLink(fixture, 'mail');

    expect(event.defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
  });

  it('ignores clicks that are not on a link', () => {
    const fixture = createComponent();
    const emitted: string[] = [];
    fixture.componentInstance.openLink.subscribe((path) => emitted.push(path));

    const paragraph = [...(fixture.nativeElement as HTMLElement).querySelectorAll('p')].find(
      (p) => p.textContent === 'plain text',
    )!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(emitted).toEqual([]);
  });
});
