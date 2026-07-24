import { ComponentMapDto } from '@/api/model/componentMapDto';
import { ComponentMapEntryDto } from '@/api/model/componentMapEntryDto';
import { SnippetComponent } from '@/shared/state/prompt-context.store';

/**
 * Resolves a picked element to the component that renders it, or undefined when nothing in the
 * workspace's component map matches. Pure and synchronous so the picker can call it inline.
 */
export type ComponentMatcher = (element: Element) => SnippetComponent | undefined;

interface Match {
  entry: ComponentMapEntryDto;
  /** The selector that matched on the DOM node (element selector or tag), for display. */
  selector: string;
}

/**
 * Builds a matcher over a workspace's component map. On match resolution, per DOM node walking
 * upward from the picked element:
 *
 * 1. Angular's dev-mode debug API (`ng.getComponent`, exposed on the framed window because daemon
 *    dev servers run dev builds) resolves the node's component instance exactly — including
 *    selector-less routed components rendered as `<ng-component>` — and its constructor name is
 *    looked up in the map.
 * 2. Fallback: the node's tag against the map's element selectors, or any of its attributes
 *    against the attribute selectors (covers prod-mode daemons, where class names are minified).
 *
 * The first matching node (the element itself included) is the owning component; matches further
 * up become the `ancestors` chain. Both paths resolve against the same backend-served map, so a
 * `ng.getComponent` hit whose class the map doesn't know degrades to the selector fallback.
 */
export function createComponentMatcher(map: ComponentMapDto): ComponentMatcher {
  const byElement = new Map<string, ComponentMapEntryDto>();
  const byClassName = new Map<string, ComponentMapEntryDto>();
  const byAttribute = new Map<string, ComponentMapEntryDto>();
  for (const entry of map.components ?? []) {
    if (entry.className && !byClassName.has(entry.className)) {
      byClassName.set(entry.className, entry);
    }
    for (const selector of entry.selectors ?? []) {
      if (selector.element && !byElement.has(selector.element)) {
        byElement.set(selector.element, entry);
      }
      if (selector.attribute && !byAttribute.has(selector.attribute)) {
        byAttribute.set(selector.attribute, entry);
      }
    }
  }

  const matchNode = (node: Element): Match | undefined => {
    const tag = node.tagName.toLowerCase();
    const byDebugApi = ngComponentClassName(node);
    if (byDebugApi) {
      const entry = byClassName.get(byDebugApi);
      if (entry) {
        return { entry, selector: displaySelector(entry, tag) };
      }
    }
    const elementEntry = byElement.get(tag);
    if (elementEntry) {
      return { entry: elementEntry, selector: tag };
    }
    for (const [attribute, entry] of byAttribute) {
      if (node.hasAttribute(attribute)) {
        return { entry, selector: '[' + attribute + ']' };
      }
    }
    return undefined;
  };

  return (element) => {
    let owner: Match | undefined;
    let lastEntry: ComponentMapEntryDto | undefined;
    const ancestors: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const match = matchNode(node);
      // consecutive nodes of one component's subtree resolve to the same entry — count it once
      if (!match || match.entry === lastEntry) {
        continue;
      }
      lastEntry = match.entry;
      if (!owner) {
        owner = match;
      } else {
        ancestors.push(match.selector);
      }
    }
    if (!owner?.entry.className || !owner.entry.componentFile) {
      return undefined;
    }
    const files = [
      owner.entry.componentFile,
      ...(owner.entry.templateFile ? [owner.entry.templateFile] : []),
      ...(owner.entry.styleFiles ?? []),
    ];
    return {
      selector: owner.selector,
      className: owner.entry.className,
      files,
      ancestors: ancestors.length > 0 ? ancestors : undefined,
    };
  };
}

/**
 * The constructor name of the component instance Angular's dev-mode debug API attributes to the
 * node, or undefined outside dev mode (the API is absent from prod builds) or on any access error
 * (the framed window is another realm; nothing here may break a pick).
 */
function ngComponentClassName(node: Element): string | undefined {
  try {
    const frameWindow = node.ownerDocument.defaultView as unknown as {
      ng?: { getComponent?: (el: Element) => object | null };
    } | null;
    const component = frameWindow?.ng?.getComponent?.(node);
    return component ? component.constructor.name : undefined;
  } catch {
    return undefined;
  }
}

/** The entry's first element selector when it has one, else the DOM node's tag. */
function displaySelector(entry: ComponentMapEntryDto, tag: string): string {
  return entry.selectors?.find((s) => s.element)?.element ?? tag;
}
