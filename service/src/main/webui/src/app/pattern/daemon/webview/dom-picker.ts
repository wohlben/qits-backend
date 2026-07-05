import { NewSnippet } from '@/shared/state/prompt-context.store';

/**
 * The parent-side DOM picker for the daemon web view. Because the proxied frame is same-origin,
 * this is ordinary code operating directly on `iframe.contentDocument` — nothing is injected into
 * the framed app. Capture-phase listeners keep the app from reacting to pick clicks; a single
 * `pointer-events: none` overlay div tracks the hovered element (no per-element mutation).
 *
 * Lifecycle: SPA navigations keep the same document, so listeners survive. Full reloads replace
 * it — the owner re-calls {@link attach} from the iframe's `load` event; that re-attach hook is
 * the entire robustness story. A frame on a foreign origin throws on `contentDocument` access:
 * {@link attach} reports it through `onAvailable(false)` and the picker degrades gracefully.
 */
export class DomPicker {
  private doc: Document | null = null;
  private overlay: HTMLElement | null = null;
  private enabled = false;

  constructor(
    private readonly onPick: (pick: NewSnippet) => void,
    private readonly onAvailable: (available: boolean) => void = () => undefined,
  ) {}

  /** (Re)binds the picker to the iframe's current document. Call from the iframe `load` event. */
  attach(iframe: HTMLIFrameElement): void {
    this.unbind();
    let doc: Document | null;
    try {
      doc = iframe.contentDocument;
      // Touch the body to force the cross-origin SecurityError, if any.
      void doc?.body;
    } catch {
      doc = null;
    }
    this.doc = doc;
    this.onAvailable(doc != null);
    if (this.enabled) {
      this.bind();
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      this.bind();
    } else {
      this.unbind(/* keepDoc= */ true);
    }
  }

  /** Fully releases the current document, listeners and overlay. */
  detach(): void {
    this.unbind();
    this.doc = null;
  }

  private bind(): void {
    if (!this.doc?.body || this.overlay) {
      return;
    }
    const overlay = this.doc.createElement('div');
    overlay.setAttribute('data-qits-pick-overlay', '');
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647';
    overlay.style.outline = '2px solid #3b82f6';
    overlay.style.background = 'rgba(59, 130, 246, 0.15)';
    overlay.style.display = 'none';
    this.doc.body.appendChild(overlay);
    this.overlay = overlay;
    this.doc.addEventListener('mousemove', this.onMouseMove, true);
    this.doc.addEventListener('click', this.onClick, true);
  }

  private unbind(keepDoc = false): void {
    if (this.doc) {
      this.doc.removeEventListener('mousemove', this.onMouseMove, true);
      this.doc.removeEventListener('click', this.onClick, true);
    }
    this.overlay?.remove();
    this.overlay = null;
    if (!keepDoc) {
      this.doc = null;
    }
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    const target = asElement(event.target);
    if (!this.overlay || !target || target === this.overlay) {
      return;
    }
    const view = this.doc?.defaultView;
    const rect = target.getBoundingClientRect();
    this.overlay.style.display = 'block';
    this.overlay.style.left = rect.left + (view?.scrollX ?? 0) + 'px';
    this.overlay.style.top = rect.top + (view?.scrollY ?? 0) + 'px';
    this.overlay.style.width = rect.width + 'px';
    this.overlay.style.height = rect.height + 'px';
  };

  private readonly onClick = (event: MouseEvent): void => {
    const target = asElement(event.target);
    if (!target) {
      return;
    }
    // The pick must not reach the app: no navigation, no button handler.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    this.onPick(buildSnippet(target));
  };
}

/**
 * Realm-safe element check: the framed document's nodes belong to the iframe's realm, so
 * `instanceof Element` against this (parent) window's constructor is always false — test the
 * node type instead.
 */
function asElement(target: EventTarget | null): Element | null {
  return target && (target as Node).nodeType === Node.ELEMENT_NODE ? (target as Element) : null;
}

function buildSnippet(element: Element): NewSnippet {
  const shadowHtml =
    element.shadowRoot != null ? element.shadowRoot.innerHTML : undefined;
  return {
    html: element.outerHTML,
    shadowHtml,
    selector: selectorFor(element),
    url: element.ownerDocument.location?.href ?? '',
    tag: element.tagName.toLowerCase(),
    textPreview: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
  };
}

/**
 * A best-effort selector: an nth-of-type chain climbing until the nearest `data-testid`/`id`
 * anchor (or the document root). A moment-in-time pointer — HMR re-renders may drift it, which is
 * why picks also carry a text preview.
 */
function selectorFor(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== node.ownerDocument.documentElement) {
    const testId = node.getAttribute('data-testid');
    if (testId) {
      parts.unshift('[data-testid="' + testId + '"]');
      return parts.join(' > ');
    }
    if (node.id) {
      parts.unshift('#' + node.id);
      return parts.join(' > ');
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    parts.unshift(tag + ':nth-of-type(' + (sameTagSiblings.indexOf(node) + 1) + ')');
    node = parent;
  }
  return parts.join(' > ');
}
