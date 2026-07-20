import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { EMPTY, Observable, catchError, debounceTime, lastValueFrom, of, switchMap, tap } from 'rxjs';

import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { WorkspacePromptDraftDto } from '@/api/model/workspacePromptDraftDto';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { buildSerializedPrompt } from '@/shared/state/snippet-format';

/**
 * Keeps a workspace's prompt draft ({@link PromptContextStore}) in sync with the backend
 * `prompt-draft` endpoints so a half-built prompt survives a refresh and follows the operator across
 * devices. Route-scoped — provide it on the workspace detail page and {@link connect} once, so its
 * hydrate query and autosave loop tear down with the route (mirrors {@code WorkspaceLiveService}).
 *
 * <p>Three moving parts:
 *
 * <ul>
 *   <li><b>Hydrate</b> — a TanStack query per workspace fetches the draft on load and patches the
 *       store (pristine-only; unsaved local edits win). The query is invalidated by the
 *       {@code prompt-draft} SSE topic, so an edit on another device rehydrates the open view.
 *   <li><b>Autosave</b> — a debounced (~1.5&nbsp;s), coalesced ({@code switchMap} = one in-flight
 *       request, cancel-and-resave on a newer edit) loop that PUTs the serialized draft, DELETEs an
 *       emptied one that had a server row, or no-ops an empty never-saved bucket.
 *   <li><b>Flush on destroy</b> — a best-effort final save when navigating away mid-debounce.
 * </ul>
 *
 * <p>The store stays HTTP-free; this service is the only thing that talks to the API. Like
 * {@code WorkspaceLiveService}, it is the sanctioned place for the observable plumbing the "no raw
 * HttpClient in components" rule keeps out of components — {@code switchMap} over the cold
 * HttpClient observable is what gives real request cancellation (last-write-wins).
 */
@Injectable()
export class PromptDraftSyncService {
  private readonly store = inject(PromptContextStore);
  private readonly draftService = inject(WorkspacePromptDraftControllerService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly repoId = signal<string | null>(null);
  private readonly workspaceId = signal<string | null>(null);

  /** Fetch-on-load + on-SSE-invalidation; 404 (never saved) maps to `null`. */
  private readonly draftQuery = injectQuery(() => ({
    queryKey: ['workspace-prompt-draft', this.repoId(), this.workspaceId()],
    enabled: this.repoId() !== null && this.workspaceId() !== null,
    queryFn: (): Promise<WorkspacePromptDraftDto | null> =>
      lastValueFrom(
        this.draftService
          .apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet(this.repoId()!, this.workspaceId()!)
          .pipe(
            catchError((err: unknown) => {
              if (err && typeof err === 'object' && (err as { status?: number }).status === 404) {
                return of(null);
              }
              throw err;
            }),
          ),
      ),
  }));

  constructor() {
    // Hydrate the store when the query resolves (or refetches after an SSE invalidation). The store
    // applies it only when still for the active workspace and pristine, so this can't clobber typing.
    effect(() => {
      const workspaceId = this.workspaceId();
      if (!workspaceId || !this.draftQuery.isSuccess()) {
        return;
      }
      const draft = this.draftQuery.data();
      this.store.hydrateFromContent(
        workspaceId,
        draft ? (draft.content ?? null) : null,
        draft ? (draft.updatedAt ?? null) : null,
      );
    });

    // Autosave: a user edit bumps the store revision → debounce → save. switchMap cancels an
    // in-flight save when a newer edit lands, so there is never more than one save in flight and the
    // latest edit always wins.
    toObservable(this.store.revision)
      .pipe(
        debounceTime(1500),
        switchMap(() => this.saveNow()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // Navigating away within the debounce window: fire one final best-effort save (no store update —
    // the component is gone and a later workspace may already own the bucket).
    this.destroyRef.onDestroy(() => this.flush());
  }

  /** Point the store + queries at a workspace; call once from the page constructor. */
  connect(repoId: string, workspaceId: string): void {
    this.store.setActiveWorkspace(workspaceId);
    this.repoId.set(repoId);
    this.workspaceId.set(workspaceId);
  }

  /**
   * The save to run for the current bucket state, or null for a no-op: a PUT when there is something
   * to persist, a DELETE when an existing row was emptied, and null otherwise (nothing dirty, ids
   * missing, or an empty bucket that never had a row — the delete-on-first-load guard). The single
   * builder both the debounced autosave and the teardown flush use, so the payload and the
   * PUT/DELETE/no-op decision can never drift between them.
   */
  private pendingRequest(): {
    kind: 'put' | 'delete';
    request: Observable<{ updatedAt?: string }>;
  } | null {
    const repoId = this.repoId();
    const workspaceId = this.workspaceId();
    if (!this.store.dirty() || !repoId || !workspaceId) {
      return null;
    }
    if (this.store.isEmpty()) {
      if (this.store.lastSavedUpdatedAt() === null) {
        return null; // empty and never saved — nothing to delete
      }
      return {
        kind: 'delete',
        request: this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete(
          repoId,
          workspaceId,
        ),
      };
    }
    return {
      kind: 'put',
      request: this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftPut(
        repoId,
        workspaceId,
        {
          content: this.store.serializeContent(),
          serializedPrompt: buildSerializedPrompt(
            this.store.promptText(),
            this.store.snippets(),
            this.store.references(),
          ),
        },
      ),
    };
  }

  /**
   * Run the pending save (if any) and record the outcome via {@code markSaved} — a PUT stamps the new
   * {@code updatedAt}, a DELETE clears the row. A failure is swallowed, leaving the bucket dirty so
   * the next edit retries.
   */
  private saveNow(): Observable<unknown> {
    const pending = this.pendingRequest();
    if (!pending) {
      return EMPTY;
    }
    return pending.request.pipe(
      tap((res) => this.store.markSaved(pending.kind === 'put' ? (res.updatedAt ?? null) : null)),
      catchError(() => EMPTY),
    );
  }

  /** Best-effort final save on teardown; subscribes without touching the store (it may now be B's). */
  private flush(): void {
    this.pendingRequest()?.request.subscribe({ error: () => undefined });
  }
}
