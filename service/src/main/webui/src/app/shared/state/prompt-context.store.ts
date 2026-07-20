import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { withQitsSnapshot } from '@qits/angular';

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
 * The current schema version of the opaque draft `content` blob the client owns. The server never
 * interprets it; bump this if the slice shapes change in a way the client must migrate.
 */
const DRAFT_CONTENT_VERSION = 1;

/**
 * The single "nothing worth persisting" rule: no prompt text, no picks, no references, and no
 * passthrough slices. Shared by the {@code isEmpty} computed (which the sync service reads to pick
 * PUT vs DELETE vs no-op) and {@code hydrateFromContent} (which uses it to decide whether a restored
 * draft raises the "Restored draft" hint) so the two can never diverge.
 */
export function isPromptContextEmpty(
  promptText: string,
  snippets: PickedSnippet[],
  references: CodeReference[],
  passthrough: Record<string, unknown>,
): boolean {
  return (
    promptText.trim() === '' &&
    snippets.length === 0 &&
    references.length === 0 &&
    Object.keys(passthrough).length === 0
  );
}

/**
 * The prompt-context store: the composition state for one workspace's next agent launch — the
 * editable prompt text, elements picked from a daemon web view, and code references selected in the
 * Files tab. Root-scoped so it outlives its collecting components and navigation, but the state it
 * holds is the **active** workspace's bucket: {@link setActiveWorkspace} resets it on a workspace
 * switch, so picks staged under workspace A never leak into workspace B (the one deliberate change
 * from the old global bag).
 *
 * The store is HTTP-free — it is the in-memory model that {@code PromptDraftSyncService} persists to
 * and hydrates from the backend `prompt-draft` endpoints. Every **user** mutation flips {@link dirty}
 * (and dismisses the restore hint) and bumps {@link revision} so the sync service's debounced
 * autosave fires; {@link hydrateFromContent} and {@link markSaved} deliberately do neither, which is
 * what keeps a hydrate from triggering a save (no autosave storm, no delete-on-first-load).
 */
export const PromptContextStore = signalStore(
  { providedIn: 'root' },
  withState({
    snippets: [] as PickedSnippet[],
    references: [] as CodeReference[],
    /** The editable "Prompt for the agent" text — moved here from speak-to-prompt component state. */
    promptText: '',
    /**
     * Unknown/newer `content` keys (a future client's `attachments`, `sketchCanvas`, `chatDraft`)
     * read from the server and re-emitted verbatim on serialize, so an older client round-trips a
     * newer draft without dropping fields.
     */
    passthrough: {} as Record<string, unknown>,
    /** The workspace the bucket currently belongs to; a change resets the bucket. */
    activeWorkspaceId: null as string | null,
    /** Unsaved local edits exist — gates autosave and blocks a pristine-only hydrate from clobbering. */
    dirty: false,
    /** The server row's `updatedAt` (ISO), or null when no row exists (never saved / deleted). */
    lastSavedUpdatedAt: null as string | null,
    /** A non-empty draft was just restored from the backend — drives the one-line restore hint. */
    justRestored: false,
    /** Monotonic edit counter the sync service debounces on; bumped only by user mutations. */
    revision: 0,
  }),
  // A qits-in-qits capture of this UI carries the active workspace's composition as app state.
  withQitsSnapshot('promptContext'),
  withComputed((store) => ({
    count: computed(() => store.snippets().length),
    /**
     * Nothing worth persisting: no prompt text, no picks, no references, and no passthrough slices.
     * An empty bucket that already has a server row autosaves as a DELETE; one that never had a row
     * is a no-op.
     */
    isEmpty: computed(() =>
      isPromptContextEmpty(store.promptText(), store.snippets(), store.references(), store.passthrough()),
    ),
  })),
  withMethods((store) => {
    // The element's identity: its selector at its pick-time document URL.
    const findExisting = (pick: NewSnippet) =>
      store.snippets().find((s) => s.selector === pick.selector && s.url === pick.url);
    const sameRef = (a: CodeReference, b: CodeReference) =>
      a.path === b.path && a.startLine === b.startLine && a.endLine === b.endLine;
    /**
     * Apply a user edit: patch the slice, mark the bucket dirty, dismiss the restore hint, and bump
     * the revision so the sync service's autosave debounce fires. The single seam every user
     * mutation goes through — so "user edit ⇒ dirty ⇒ autosave" holds by construction.
     */
    const commit = (updater: (state: { snippets: PickedSnippet[]; references: CodeReference[] }) => object) =>
      patchState(store, (state) => ({
        ...updater(state),
        dirty: true,
        justRestored: false,
        revision: state.revision + 1,
      }));
    const remove = (id: string): void => {
      commit((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) }));
    };
    /**
     * Idempotent on the element's identity: re-adding an already picked element returns the
     * existing snippet instead of adding a duplicate (and leaves the bucket unchanged, so a re-pick
     * doesn't dirty the draft).
     */
    const add = (pick: NewSnippet): PickedSnippet => {
      const existing = findExisting(pick);
      if (existing) {
        return existing;
      }
      const snippet: PickedSnippet = { ...pick, id: crypto.randomUUID(), capturedAt: Date.now() };
      commit((state) => ({ snippets: [...state.snippets, snippet] }));
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
        commit((state) => ({ references: mergeReference(state.references, ref) }));
      },
      /** Removes by value — a reference's identity is its `(path, startLine, endLine)` triple. */
      removeReference(ref: CodeReference): void {
        commit((state) => ({ references: state.references.filter((r) => !sameRef(r, ref)) }));
      },
      /** Sets the editable prompt text (the speak-to-prompt "Prompt for the agent" textarea). */
      setPromptText(text: string): void {
        commit(() => ({ promptText: text }));
      },
      /**
       * Empties the whole active bucket — prompt text, snippets, references, passthrough; "start a
       * fresh prompt". Marks dirty, so if a server row exists the sync service DELETEs it. Backs the
       * restore hint's "Discard" (throw the restored draft away entirely).
       */
      clear(): void {
        commit(() => ({ snippets: [], references: [], promptText: '', passthrough: {} }));
      },
      /**
       * Drops the collected context (picked elements + code references) but keeps the typed prompt
       * text and passthrough — the web-view tray's "Clear picked" affordance, which must not destroy
       * the composed prompt. Marks dirty so the trimmed draft autosaves (or DELETEs if now empty).
       */
      clearContext(): void {
        commit(() => ({ snippets: [], references: [] }));
      },
      /**
       * Point the store at a workspace, resetting the bucket to empty when it changes. Called by the
       * sync service before hydrating; does NOT bump the revision, so switching workspaces never
       * autosaves the fresh empty bucket.
       */
      setActiveWorkspace(workspaceId: string): void {
        if (store.activeWorkspaceId() === workspaceId) {
          return;
        }
        patchState(store, {
          activeWorkspaceId: workspaceId,
          snippets: [],
          references: [],
          promptText: '',
          passthrough: {},
          dirty: false,
          lastSavedUpdatedAt: null,
          justRestored: false,
        });
      },
      /** The opaque `content` blob the server stores verbatim: known slices plus any passthrough. */
      serializeContent(): string {
        return JSON.stringify({
          ...store.passthrough(),
          v: DRAFT_CONTENT_VERSION,
          promptText: store.promptText(),
          snippets: store.snippets(),
          references: store.references(),
        });
      },
      /**
       * Apply a draft fetched from the backend — but only when it is still for the active workspace
       * and the local bucket is pristine (unsaved local edits always win; the device mid-typing keeps
       * its version and re-saves on its next autosave). `content === null` means the server has no row
       * (404 / deleted elsewhere): clear to empty. A parse failure treats the composition as absent
       * but records the row's timestamp. Never marks dirty, so hydrating never triggers a save.
       */
      hydrateFromContent(
        workspaceId: string,
        content: string | null,
        updatedAt: string | null,
      ): void {
        if (workspaceId !== store.activeWorkspaceId() || store.dirty()) {
          return;
        }
        // Our own save echoes back over SSE with the timestamp we already recorded — ignore it, so
        // an autosave never re-raises the "Restored draft" hint. A genuine remote edit carries a
        // newer timestamp and falls through.
        if (content !== null && updatedAt !== null && updatedAt === store.lastSavedUpdatedAt()) {
          return;
        }
        if (content === null) {
          patchState(store, {
            snippets: [],
            references: [],
            promptText: '',
            passthrough: {},
            lastSavedUpdatedAt: null,
            justRestored: false,
          });
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          patchState(store, { lastSavedUpdatedAt: updatedAt, justRestored: false });
          return;
        }
        if (typeof parsed !== 'object' || parsed === null) {
          patchState(store, { lastSavedUpdatedAt: updatedAt, justRestored: false });
          return;
        }
        const passthrough: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
        const promptText = typeof passthrough['promptText'] === 'string' ? passthrough['promptText'] : '';
        const snippets = Array.isArray(passthrough['snippets'])
          ? (passthrough['snippets'] as PickedSnippet[])
          : [];
        const references = Array.isArray(passthrough['references'])
          ? (passthrough['references'] as CodeReference[])
          : [];
        delete passthrough['v'];
        delete passthrough['promptText'];
        delete passthrough['snippets'];
        delete passthrough['references'];
        const empty = isPromptContextEmpty(promptText, snippets, references, passthrough);
        patchState(store, {
          promptText,
          snippets,
          references,
          passthrough,
          lastSavedUpdatedAt: updatedAt,
          justRestored: !empty,
        });
      },
      /** Record a completed save (PUT → the new `updatedAt`, DELETE → null); clears the dirty flag. */
      markSaved(updatedAt: string | null): void {
        patchState(store, { dirty: false, lastSavedUpdatedAt: updatedAt });
      },
    };
  }),
);
