import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

/**
 * The component attributed as rendering a picked element: the nearest enclosing component the
 * matcher could resolve, with its source files so the agent can open the code directly instead of
 * grepping for it. Paths are workspace-relative; only paths ride along, never contents.
 */
export interface SnippetComponent {
  selector: string;
  className: string;
  /** Workspace-relative source files: the component .ts, then template/styles when external. */
  files: string[];
  /** Enclosing component selectors, inner → outer — context for projected content. */
  ancestors?: string[];
}

/**
 * One DOM element picked from a daemon's web view — a structural pointer for the agent, not a
 * reproduction (the HTML carries dev-time attributes and no computed styles).
 */
export interface PickedSnippet {
  id: string;
  /** The element's outerHTML (shallow for custom elements — see shadowHtml). */
  html: string;
  /**
   * Optional style-frozen variant of {@link html}: the same fragment with every node's applied
   * CSS (author rules, inheritance, inline styles) inlined as a `style` attribute, so it renders
   * alike without the page's stylesheets. Best-effort — absent when the capture failed.
   */
  styledHtml?: string;
  /** innerHTML of the element's open shadow root, when it has one. */
  shadowHtml?: string;
  /** A best-effort selector: nearest id/data-testid anchor plus an nth-of-type chain. */
  selector: string;
  /** The framed document's location at pick time. */
  url: string;
  /** The app-side route at pick time — {@link url} with the daemon's proxy prefix stripped. */
  appPath?: string;
  tag: string;
  textPreview: string;
  /** Best-effort attribution of the component that renders the element. */
  component?: SnippetComponent;
  capturedAt: number;
}

export type NewSnippet = Omit<PickedSnippet, 'id' | 'capturedAt'>;

/** A collected reference to a range of a file, staged to later become part of a Claude prompt. */
export interface CodeReference {
  path: string;
  startLine: number;
  endLine: number;
  /**
   * The referenced lines' text, captured at pick time. Display-only (the Chat tab's preview) —
   * never serialized into the prompt, so staleness after workspace edits is cosmetic. Optional:
   * refs from producers without the file content omit it.
   */
  excerpt?: string;
}

/**
 * Two same-file ranges merge when they overlap or touch (adjacent lines) — a single predicate so
 * switching to strict-overlap-only (`a.startLine <= b.endLine && b.startLine <= a.endLine`) stays
 * a one-line change.
 */
const shouldMerge = (a: CodeReference, b: CodeReference): boolean =>
  a.path === b.path && a.startLine <= b.endLine + 1 && b.startLine <= a.endLine + 1;

/** The 1-based line-number → text map an excerpt-carrying reference contributes. */
function excerptLines(ref: CodeReference): Map<number, string> {
  const lines = new Map<number, string>();
  if (ref.excerpt !== undefined) {
    ref.excerpt.split('\n').forEach((text, i) => lines.set(ref.startLine + i, text));
  }
  return lines;
}

/**
 * Reconstructs a merged range's excerpt from its partners' line maps: the merge rule guarantees
 * the union is contiguous, so the excerpt is the map read out from `startLine` to `endLine`.
 * Later partners overwrite earlier ones on overlapping lines — the caller puts the incoming
 * pick last so its (fresh) text wins over a stale one. Undefined when any line is missing,
 * i.e. a partner carried no excerpt: a fabricated gap would misrepresent the range.
 */
function stitchExcerpt(
  partners: CodeReference[],
  startLine: number,
  endLine: number,
): string | undefined {
  const lines = new Map<number, string>();
  for (const partner of partners) {
    for (const [n, text] of excerptLines(partner)) {
      lines.set(n, text);
    }
  }
  const out: string[] = [];
  for (let n = startLine; n <= endLine; n++) {
    const text = lines.get(n);
    if (text === undefined) {
      return undefined;
    }
    out.push(text);
  }
  return out.join('\n');
}

/**
 * Adds `ref` to `refs`, collapsing it with every same-path reference it overlaps or touches into
 * one min-start/max-end range (transitively: a range bridging two references absorbs both). The
 * merged reference keeps the position of the first partner it absorbed so chips don't jump, and
 * its excerpt is stitched from the partners' excerpts (the incoming pick's lines win); a
 * disjoint reference is appended. Pure — always returns a new array.
 */
export function mergeReference(refs: CodeReference[], ref: CodeReference): CodeReference[] {
  let startLine = ref.startLine;
  let endLine = ref.endLine;
  const absorbed: CodeReference[] = [];
  const rest: CodeReference[] = [];
  let insertAt = -1;
  // A single pass is complete: store-held refs are pairwise non-mergeable (every add goes through
  // this function), so the growing interval can never retroactively reach a skipped ref.
  for (const existing of refs) {
    if (shouldMerge(existing, { path: ref.path, startLine, endLine })) {
      if (insertAt === -1) {
        insertAt = rest.length;
      }
      absorbed.push(existing);
      startLine = Math.min(existing.startLine, startLine);
      endLine = Math.max(existing.endLine, endLine);
    } else {
      rest.push(existing);
    }
  }
  const excerpt =
    insertAt === -1 ? ref.excerpt : stitchExcerpt([...absorbed, ref], startLine, endLine);
  const merged: CodeReference = { path: ref.path, startLine, endLine };
  if (excerpt !== undefined) {
    merged.excerpt = excerpt; // keep the key absent (not `undefined`) on excerpt-less refs
  }
  if (insertAt === -1) {
    return [...rest, merged];
  }
  rest.splice(insertAt, 0, merged);
  return rest;
}

/**
 * The prompt-context cache: elements picked from a daemon web view plus code references selected
 * in the Files tab, waiting to be handed to an agent. Root-scoped so both outlive their collecting
 * component and navigation — pick or select, then use them from speak-to-prompt (initialContext)
 * or a command chat (draft). The consumers render the tray; this store is only the cache.
 */
export const PromptContextStore = signalStore(
  { providedIn: 'root' },
  withState({ snippets: [] as PickedSnippet[], references: [] as CodeReference[] }),
  withComputed((store) => ({
    count: computed(() => store.snippets().length),
  })),
  withMethods((store) => {
    // The element's identity: its selector at its pick-time document URL.
    const findExisting = (pick: NewSnippet) =>
      store.snippets().find((s) => s.selector === pick.selector && s.url === pick.url);
    const sameRef = (a: CodeReference, b: CodeReference) =>
      a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;
    const remove = (id: string): void => {
      patchState(store, (state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    };
    /**
     * Idempotent on the element's identity: re-adding an already picked element returns the
     * existing snippet instead of adding a duplicate.
     */
    const add = (pick: NewSnippet): PickedSnippet => {
      const existing = findExisting(pick);
      if (existing) {
        return existing;
      }
      const snippet: PickedSnippet = { ...pick, id: crypto.randomUUID(), capturedAt: Date.now() };
      patchState(store, (state) => ({ snippets: [...state.snippets, snippet] }));
      return snippet;
    };
    return {
      add,
      remove,
      /**
       * The pick gesture: adds the element, or — when it is already picked — removes it again.
       * Returns the added snippet, or null when the pick unpicked an existing one.
       */
      toggle(pick: NewSnippet): PickedSnippet | null {
        const existing = findExisting(pick);
        if (existing) {
          remove(existing.id);
          return null;
        }
        return add(pick);
      },
      /** Stages a reference, merging it into any same-path references it overlaps or touches. */
      addReference(ref: CodeReference): void {
        patchState(store, (state) => ({ references: mergeReference(state.references, ref) }));
      },
      /** Removes by value — a reference's identity is its `(path, startLine, endLine)` triple. */
      removeReference(ref: CodeReference): void {
        patchState(store, (state) => ({
          references: state.references.filter((r) => !sameRef(r, ref)),
        }));
      },
      /** Empties the whole context — snippets and references; "start a fresh prompt". */
      clear(): void {
        patchState(store, { snippets: [], references: [] });
      },
    };
  }),
);
