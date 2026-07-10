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

/**
 * The prompt-context cache: elements picked from a daemon web view, waiting to be handed to an
 * agent. Root-scoped so picks outlive the web-view dialog and navigation — pick, close the frame,
 * then use them from speak-to-prompt (initialContext) or a command chat (draft). The consumers
 * render the tray; this store is only the cache.
 */
export const PromptContextStore = signalStore(
  { providedIn: 'root' },
  withState({ snippets: [] as PickedSnippet[] }),
  withComputed((store) => ({
    count: computed(() => store.snippets().length),
  })),
  withMethods((store) => {
    // The element's identity: its selector at its pick-time document URL.
    const findExisting = (pick: NewSnippet) =>
      store.snippets().find((s) => s.selector === pick.selector && s.url === pick.url);
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
      clear(): void {
        patchState(store, { snippets: [] });
      },
    };
  }),
);
