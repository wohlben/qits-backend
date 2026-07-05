import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

/**
 * One DOM element picked from a daemon's web view — a structural pointer for the agent, not a
 * reproduction (the HTML carries dev-time attributes and no computed styles).
 */
export interface PickedSnippet {
  id: string;
  /** The element's outerHTML (shallow for custom elements — see shadowHtml). */
  html: string;
  /** innerHTML of the element's open shadow root, when it has one. */
  shadowHtml?: string;
  /** A best-effort selector: nearest id/data-testid anchor plus an nth-of-type chain. */
  selector: string;
  /** The framed document's location at pick time. */
  url: string;
  tag: string;
  textPreview: string;
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
  withMethods((store) => ({
    add(pick: NewSnippet): PickedSnippet {
      const snippet: PickedSnippet = { ...pick, id: crypto.randomUUID(), capturedAt: Date.now() };
      patchState(store, (state) => ({ snippets: [...state.snippets, snippet] }));
      return snippet;
    },
    remove(id: string): void {
      patchState(store, (state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    },
    clear(): void {
      patchState(store, { snippets: [] });
    },
  })),
);
