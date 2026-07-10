import { NewSnippet } from '@/shared/state/prompt-context.store';
import { DomPicker, LONG_PRESS_MS, PickedRef, PickOptions } from './dom-picker';

/**
 * Functional picker coverage in a real headless Chromium (Vitest browser mode — jsdom's iframe
 * support is not faithful enough for contentDocument + real event dispatch). A same-origin
 * `srcdoc` frame stands in for the proxied daemon app.
 */

function frameWith(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.width = '600px';
    iframe.style.height = '400px';
    // The initial about:blank also fires load — wait until the srcdoc content is really there.
    const onLoad = () => {
      if (iframe.contentDocument?.body?.childElementCount) {
        iframe.removeEventListener('load', onLoad);
        resolve(iframe);
      }
    };
    iframe.addEventListener('load', onLoad);
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
}

function click(doc: Document, element: Element, init: MouseEventInit = {}): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
}

function pointerDown(element: Element, pointerType: string): void {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));
}

function hover(doc: Document, element: Element): void {
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent('mousemove', {
      bubbles: true,
      clientX: rect.left + 1,
      clientY: rect.top + 1,
    }),
  );
}

describe('DomPicker', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach((f) => f.remove());
  });

  it('captures the clicked element without triggering the app handler', async () => {
    const iframe = await frameWith(
      '<div id="root"><button class="cta" onclick="window.appClicked = true">Go</button></div>',
    );
    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    const button = doc.querySelector('button')!;
    click(doc, button);

    expect(picks.length).toBe(1);
    expect(picks[0].tag).toBe('button');
    expect(picks[0].html).toContain('class="cta"');
    expect(picks[0].selector).toBe('#root > button:nth-of-type(1)');
    expect(picks[0].textPreview).toBe('Go');
    const appClicked = (iframe.contentWindow as unknown as { appClicked?: boolean }).appClicked;
    expect(appClicked).toBeUndefined();
    picker.detach();
  });

  it('prefers data-testid anchors in the selector', async () => {
    const iframe = await frameWith(
      '<section data-testid="cart"><ul><li>a</li><li id="target">b</li></ul></section>',
    );
    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    click(doc, doc.getElementById('target')!);

    expect(picks[0].selector).toBe('#target');

    click(doc, doc.querySelector('ul')!);
    expect(picks[1].selector).toBe('[data-testid="cart"] > ul:nth-of-type(1)');
    picker.detach();
  });

  it('positions the hover overlay over the hovered element', async () => {
    const iframe = await frameWith(
      '<div style="margin: 50px"><p style="width: 120px">hover me</p></div>',
    );
    const picker = new DomPicker(() => undefined);
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    const p = doc.querySelector('p')!;
    hover(doc, p);

    const overlay = doc.querySelector('[data-qits-pick-overlay]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.display).toBe('block');
    const rect = p.getBoundingClientRect();
    expect(Number.parseFloat(overlay.style.left)).toBeCloseTo(rect.left, 0);
    expect(Number.parseFloat(overlay.style.width)).toBeCloseTo(rect.width, 0);
    picker.detach();
  });

  it('re-attaches after a full reload of the frame via the load event', async () => {
    const iframe = await frameWith('<button id="first">one</button>');
    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);
    picker.setEnabled(true);

    // Full reload: srcdoc reassignment replaces the document; the owner re-attaches on load,
    // exactly like the component's (load) binding does.
    await new Promise<void>((resolve) => {
      iframe.addEventListener(
        'load',
        () => {
          picker.attach(iframe);
          resolve();
        },
        { once: true },
      );
      iframe.srcdoc = '<button id="second">two</button>';
    });

    const doc = iframe.contentDocument!;
    click(doc, doc.getElementById('second')!);
    expect(picks.length).toBe(1);
    expect(picks[0].selector).toBe('#second');
    picker.detach();
  });

  it('captures an open shadow root alongside the shallow outerHTML', async () => {
    const iframe = await frameWith('<div id="host"></div>');
    const doc = iframe.contentDocument!;
    const host = doc.getElementById('host')!;
    host.attachShadow({ mode: 'open' }).innerHTML = '<span>inside</span>';

    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);
    picker.setEnabled(true);

    click(doc, host);
    expect(picks[0].shadowHtml).toBe('<span>inside</span>');
    expect(picks[0].html).toContain('id="host"');
    picker.detach();
  });

  it('reports a plain click as a one-shot pick and shift-click as keepPicking', async () => {
    const iframe = await frameWith('<button>multi</button>');
    const options: PickOptions[] = [];
    const picker = new DomPicker((_pick, o) => options.push(o));
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    const button = doc.querySelector('button')!;
    pointerDown(button, 'mouse');
    click(doc, button);
    expect(options[0].keepPicking).toBe(false);

    pointerDown(button, 'mouse');
    click(doc, button, { shiftKey: true });
    expect(options[1].keepPicking).toBe(true);
    picker.detach();
  });

  it('reports a touch long press as keepPicking, a short tap as one-shot', async () => {
    const iframe = await frameWith('<button>touch</button>');
    const options: PickOptions[] = [];
    const picker = new DomPicker((_pick, o) => options.push(o));
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    const button = doc.querySelector('button')!;
    pointerDown(button, 'touch');
    click(doc, button);
    expect(options[0].keepPicking).toBe(false);

    pointerDown(button, 'touch');
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 50));
    click(doc, button);
    expect(options[1].keepPicking).toBe(true);

    // A mouse press of the same duration stays one-shot — long press is a coarse-input gesture.
    pointerDown(button, 'mouse');
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 50));
    click(doc, button);
    expect(options[2].keepPicking).toBe(false);
    picker.detach();
  });

  it('suppresses the context menu while picking, so a long press can reach the click', async () => {
    const iframe = await frameWith('<button>menu</button>');
    const picker = new DomPicker(() => undefined);
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    doc.querySelector('button')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    picker.setEnabled(false);
    const offEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    doc.querySelector('button')!.dispatchEvent(offEvent);
    expect(offEvent.defaultPrevented).toBe(false);
    picker.detach();
  });

  it('outlines already-picked elements while picking and reverts them when picking stops', async () => {
    const iframe = await frameWith(
      '<button id="a" style="outline: 1px dotted red">a</button><button id="b">b</button>',
    );
    const doc = iframe.contentDocument!;
    const picker = new DomPicker(() => undefined);
    picker.attach(iframe);
    picker.setPicked([{ selector: '#a', url: doc.location.href }]);

    // Not yet in pick mode — no marks.
    expect(doc.querySelector('[data-qits-picked]')).toBeNull();

    const a = doc.getElementById('a')!;
    const originalOutline = a.style.outline; // as normalized by the browser
    picker.setEnabled(true);
    expect(a.hasAttribute('data-qits-picked')).toBe(true);
    expect(a.style.outline).toContain('rgb(34, 197, 94)');
    expect(doc.getElementById('b')!.hasAttribute('data-qits-picked')).toBe(false);

    // Turning pick mode off restores the element's own inline outline.
    picker.setEnabled(false);
    expect(a.hasAttribute('data-qits-picked')).toBe(false);
    expect(a.style.outline).toBe(originalOutline);
    expect(a.style.outline).toContain('dotted');
    picker.detach();
  });

  it('marks a newly picked element as soon as the owner feeds the pick back', async () => {
    const iframe = await frameWith('<button id="target">pick me</button>');
    const doc = iframe.contentDocument!;
    const picked: PickedRef[] = [];
    const picker = new DomPicker((pick) => {
      picked.push({ selector: pick.selector, url: pick.url });
      picker.setPicked(picked);
    });
    picker.attach(iframe);
    picker.setEnabled(true);

    const target = doc.getElementById('target')!;
    click(doc, target, { shiftKey: true });

    expect(target.hasAttribute('data-qits-picked')).toBe(true);
    picker.detach();
  });

  it('skips refs from other pages and selectors that no longer resolve', async () => {
    const iframe = await frameWith('<button id="a">a</button>');
    const doc = iframe.contentDocument!;
    const picker = new DomPicker(() => undefined);
    picker.attach(iframe);
    picker.setPicked([
      { selector: '#a', url: 'http://elsewhere/other-page' },
      { selector: '#gone', url: doc.location.href },
      { selector: ':::not-a-selector', url: doc.location.href },
    ]);
    picker.setEnabled(true);

    expect(doc.querySelector('[data-qits-picked]')).toBeNull();
    picker.detach();
  });

  it('does not capture while pick mode is off', async () => {
    const iframe = await frameWith('<button>quiet</button>');
    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);

    const doc = iframe.contentDocument!;
    click(doc, doc.querySelector('button')!);
    expect(picks.length).toBe(0);
    picker.detach();
  });
});
