import { NewSnippet } from '@/shared/state/prompt-context.store';
import { DomPicker } from './dom-picker';
import { freezeAppliedStyles } from './style-freeze';

/**
 * Style freezing needs a real layout engine (jsdom computes no styles), so this runs in Vitest
 * browser mode like the picker spec. A same-origin `srcdoc` frame stands in for the framed app.
 */

function frameWith(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.width = '600px';
    iframe.style.height = '400px';
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

describe('freezeAppliedStyles', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach((f) => f.remove());
  });

  it('inlines styles applied by page CSS rules, on the element and its descendants', async () => {
    const iframe = await frameWith(
      '<style>button { color: rgb(255, 0, 0); } span { font-weight: 700; }</style>' +
        '<div id="root"><button>Go <span>now</span></button></div>',
    );
    const button = iframe.contentDocument!.querySelector('button')!;

    const styled = freezeAppliedStyles(button)!;

    expect(styled).toContain('color: rgb(255, 0, 0)');
    expect(styled).toMatch(/<span style="[^"]*font-weight: 700/);
    // The element itself is untouched — the original capture stays rule-free.
    expect(button.outerHTML).not.toContain('style=');
  });

  it('freezes inherited and inline styles too', async () => {
    const iframe = await frameWith(
      '<style>body { font-family: monospace; }</style>' +
        '<p style="color: rgb(0, 0, 255)">text</p>',
    );
    const p = iframe.contentDocument!.querySelector('p')!;

    const styled = freezeAppliedStyles(p)!;

    expect(styled).toContain('color: rgb(0, 0, 255)');
    expect(styled).toContain('font-family: monospace');
  });

  it('omits properties left at their UA default', async () => {
    const iframe = await frameWith('<style>p { color: rgb(255, 0, 0); }</style><p>plain</p>');
    const p = iframe.contentDocument!.querySelector('p')!;

    const styled = freezeAppliedStyles(p)!;

    // display stays the UA-default "block" for a <p>, so the diff must not carry it.
    expect(styled).not.toContain('display: block');
    expect(styled).toContain('color: rgb(255, 0, 0)');
  });

  it('strips picker artifacts: marks, mark outlines, and the hover overlay', async () => {
    const iframe = await frameWith('<div id="root"><button id="a">a</button></div>');
    const doc = iframe.contentDocument!;
    const a = doc.getElementById('a')!;
    a.setAttribute('data-qits-picked', '');
    a.style.outline = '2px solid #22c55e';
    const overlay = doc.createElement('div');
    overlay.setAttribute('data-qits-pick-overlay', '');
    doc.getElementById('root')!.appendChild(overlay);

    const styled = freezeAppliedStyles(doc.getElementById('root')!)!;

    expect(styled).not.toContain('data-qits-picked');
    expect(styled).not.toContain('data-qits-pick-overlay');
    expect(styled).not.toContain('rgb(34, 197, 94)');
  });
});

describe('DomPicker styledHtml capture', () => {
  afterEach(() => {
    document.querySelectorAll('iframe').forEach((f) => f.remove());
  });

  it('a pick carries both the original html and the style-frozen variant', async () => {
    const iframe = await frameWith(
      '<style>button { color: rgb(255, 0, 0); }</style><button class="cta">Go</button>',
    );
    const picks: NewSnippet[] = [];
    const picker = new DomPicker((p) => picks.push(p));
    picker.attach(iframe);
    picker.setEnabled(true);

    const doc = iframe.contentDocument!;
    doc
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(picks[0].html).toBe('<button class="cta">Go</button>');
    expect(picks[0].styledHtml).toContain('color: rgb(255, 0, 0)');
    picker.detach();
  });
});
