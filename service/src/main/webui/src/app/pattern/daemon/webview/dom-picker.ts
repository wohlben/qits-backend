import { NewSnippet, SnippetComponent } from '@/shared/state/prompt-context.store';
import { ComponentMatcher } from './component-matcher';
import { freezeAppliedStyles } from './style-freeze';

/** Per-pick modifiers, derived from the picking gesture. */
export interface PickOptions {
  /**
   * True for a shift-click, or a long press on coarse (touch) input — the "pick several"
   * gestures. The owner keeps pick mode on; a plain click is a one-shot pick.
   */
  keepPicking: boolean;
}

/** Press duration (pointerdown → click) from which a touch press counts as a long press. */
export const LONG_PRESS_MS = 500;

/** Identity of an already-picked element, as stored in the prompt context. */
export interface PickedRef {
  selector: string;
  /** The document URL at pick time — refs from other pages are not marked. */
  url: string;
}

/**
 * The parent-side DOM picker for the daemon web view. Because the proxied frame is same-origin,
 * this is ordinary code operating directly on `iframe.contentDocument` — nothing is injected into
 * the framed app. Capture-phase listeners keep the app from reacting to pick clicks; a single
 * `pointer-events: none` overlay div tracks the hovered element. Already-picked elements (fed in
 * via {@link setPicked}) are outlined while pick mode is on, and reverted when it turns off.
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
  private lastPointerDown: { timeStamp: number; coarse: boolean } | null = null;
  private picked: PickedRef[] = [];
  private marked: { element: HTMLElement; outline: string; outlineOffset: string }[] = [];
  private matcher: ComponentMatcher | null = null;

  constructor(
    private readonly onPick: (pick: NewSnippet, options: PickOptions) => void,
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

  /**
   * Tells the picker which elements are already picked, so it can mark them while pick mode is
   * on. Marks are best-effort: a ref is resolved via its stored selector against the current
   * document, so refs from other pages (URL mismatch) or drifted selectors are simply skipped.
   */
  setPicked(picked: PickedRef[]): void {
    this.picked = picked;
    if (this.enabled && this.doc) {
      this.refreshMarks();
    }
  }

  /**
   * Hands the picker the component matcher for the framed app, so picks carry an attribution of
   * the component that renders them. A setter (not a constructor arg) because the component map
   * arrives asynchronously — picks made before it resolves simply carry no attribution.
   */
  setMatcher(matcher: ComponentMatcher | null): void {
    this.matcher = matcher;
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
    this.doc.addEventListener('pointerdown', this.onPointerDown, true);
    this.doc.addEventListener('contextmenu', this.onContextMenu, true);
    this.doc.addEventListener('click', this.onClick, true);
    this.refreshMarks();
  }

  private unbind(keepDoc = false): void {
    if (this.doc) {
      this.doc.removeEventListener('mousemove', this.onMouseMove, true);
      this.doc.removeEventListener('pointerdown', this.onPointerDown, true);
      this.doc.removeEventListener('contextmenu', this.onContextMenu, true);
      this.doc.removeEventListener('click', this.onClick, true);
    }
    this.overlay?.remove();
    this.overlay = null;
    this.lastPointerDown = null;
    this.clearMarks();
    if (!keepDoc) {
      this.doc = null;
    }
  }

  /**
   * Outlines every already-picked element of the current page. Unlike the hover overlay this
   * mutates the elements' inline outline (reverted by {@link clearMarks}) — an element-attached
   * style tracks scroll and re-layout for free, which body-positioned overlay divs would not.
   */
  private refreshMarks(): void {
    this.clearMarks();
    const doc = this.doc;
    if (!doc?.body) {
      return;
    }
    const href = doc.location?.href ?? '';
    for (const ref of this.picked) {
      if (ref.url !== href) {
        continue;
      }
      let element: Element | null = null;
      try {
        element = doc.querySelector(ref.selector);
      } catch {
        continue; // drifted into an invalid selector — skip the mark
      }
      // Realm-safe HTMLElement check: `instanceof` won't work on the frame's nodes.
      if (!element || !('style' in element)) {
        continue;
      }
      const el = element as HTMLElement;
      this.marked.push({ element: el, outline: el.style.outline, outlineOffset: el.style.outlineOffset });
      el.setAttribute('data-qits-picked', '');
      el.style.outline = '2px solid #22c55e';
      el.style.outlineOffset = '-2px';
    }
  }

  private clearMarks(): void {
    for (const mark of this.marked) {
      mark.element.removeAttribute('data-qits-picked');
      mark.element.style.outline = mark.outline;
      mark.element.style.outlineOffset = mark.outlineOffset;
    }
    this.marked = [];
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

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.lastPointerDown = { timeStamp: event.timeStamp, coarse: event.pointerType === 'touch' };
  };

  /**
   * While picking, a touch long press means "keep picking" — the native context menu / selection
   * callout it would otherwise open must not appear (and would swallow the click).
   */
  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
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
    const down = this.lastPointerDown;
    const longPress =
      down != null && down.coarse && event.timeStamp - down.timeStamp >= LONG_PRESS_MS;
    this.onPick(buildSnippet(target, this.matcher), { keepPicking: event.shiftKey || longPress });
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

function buildSnippet(element: Element, matcher: ComponentMatcher | null): NewSnippet {
  const shadowHtml =
    element.shadowRoot != null ? element.shadowRoot.innerHTML : undefined;
  return {
    html: element.outerHTML,
    styledHtml: freezeAppliedStyles(element),
    shadowHtml,
    selector: selectorFor(element),
    url: element.ownerDocument.location?.href ?? '',
    tag: element.tagName.toLowerCase(),
    textPreview: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    component: attributeComponent(element, matcher),
  };
}

/** Best-effort: attribution enriches a pick but must never break one. */
function attributeComponent(
  element: Element,
  matcher: ComponentMatcher | null,
): SnippetComponent | undefined {
  try {
    return matcher?.(element) ?? undefined;
  } catch {
    return undefined;
  }
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
