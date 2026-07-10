/**
 * Freezes the CSS applied to an element into inline `style` attributes: a deep clone where every
 * node carries the styles it effectively had (author rules, inheritance, inline styles) — so the
 * fragment renders alike without the page's stylesheets. To keep the output readable, only
 * properties whose computed value differs from the tag's bare UA default are inlined; the
 * defaults are measured on pristine elements inside a stylesheet-free hidden iframe in the
 * parent document (measuring them in the framed page would pick up the very author rules being
 * frozen, and diff them away).
 *
 * Picker artifacts are excluded: the hover overlay div is dropped from the clone, and marked
 * (`data-qits-picked`) nodes lose the mark plus its outline styles.
 */
export function freezeAppliedStyles(element: Element): string | undefined {
  const view = element.ownerDocument.defaultView;
  if (!view) {
    return undefined;
  }
  const baseline = document.createElement('iframe');
  // Off-screen instead of display:none — inside a display:none iframe computed styles are empty.
  baseline.style.position = 'fixed';
  baseline.style.left = '-10000px';
  baseline.style.width = '10px';
  baseline.style.height = '10px';
  baseline.setAttribute('aria-hidden', 'true');
  document.body.appendChild(baseline);
  try {
    const baselineDoc = baseline.contentDocument;
    if (!baselineDoc?.body) {
      return undefined;
    }
    const clone = element.cloneNode(true) as Element;
    freezeInto(element, clone, { view, baselineDoc, defaults: new Map() });
    return clone.outerHTML;
  } catch {
    return undefined; // best-effort: the plain capture stands on its own
  } finally {
    baseline.remove();
  }
}

interface FreezeContext {
  view: Window;
  baselineDoc: Document;
  /** Per-tag snapshot of the UA-default computed style. */
  defaults: Map<string, Map<string, string>>;
}

function freezeInto(orig: Element, clone: Element, ctx: FreezeContext): void {
  if (orig.hasAttribute('data-qits-pick-overlay')) {
    clone.remove();
    return;
  }
  const isMarked = orig.hasAttribute('data-qits-picked');
  const computed = ctx.view.getComputedStyle(orig);
  const defaults = defaultsFor(orig.tagName, ctx);
  const decls: string[] = [];
  for (let i = 0; i < computed.length; i++) {
    const prop = computed.item(i);
    if (isMarked && prop.startsWith('outline')) {
      continue; // the mark's green outline is ours, not the page's
    }
    const value = computed.getPropertyValue(prop);
    if (defaults.get(prop) !== value) {
      decls.push(prop + ': ' + value);
    }
  }
  clone.removeAttribute('data-qits-picked');
  if (decls.length > 0) {
    clone.setAttribute('style', decls.join('; '));
  }
  const origChildren = Array.from(orig.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < origChildren.length; i++) {
    freezeInto(origChildren[i], cloneChildren[i], ctx);
  }
}

function defaultsFor(tagName: string, ctx: FreezeContext): Map<string, string> {
  const cached = ctx.defaults.get(tagName);
  if (cached) {
    return cached;
  }
  const probe = ctx.baselineDoc.createElement(tagName);
  ctx.baselineDoc.body.appendChild(probe);
  const style = ctx.baselineDoc.defaultView!.getComputedStyle(probe);
  // Snapshot: the declaration object is live and empties once the probe is removed.
  const snapshot = new Map<string, string>();
  for (let i = 0; i < style.length; i++) {
    const prop = style.item(i);
    snapshot.set(prop, style.getPropertyValue(prop));
  }
  probe.remove();
  ctx.defaults.set(tagName, snapshot);
  return snapshot;
}
