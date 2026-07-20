import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { QueryClient, injectQuery } from '@tanstack/angular-query-experimental';
import { EMPTY, Observable, catchError, debounceTime, lastValueFrom, switchMap, tap } from 'rxjs';

import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { PromptAttachmentSource } from '@/api/model/promptAttachmentSource';
import { WorkspacePromptAttachmentDataDto } from '@/api/model/workspacePromptAttachmentDataDto';
import { PromptContextStore, PromptImage } from '@/shared/state/prompt-context.store';
import { buildSerializedPrompt } from '@/shared/state/snippet-format';
import { fetchPromptDraft, promptDraftQueryKey } from './prompt-draft-query';

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
  private readonly queryClient = inject(QueryClient);

  private readonly repoId = signal<string | null>(null);
  private readonly workspaceId = signal<string | null>(null);

  /** Fetch-on-load + on-SSE-invalidation; 404 (never saved) maps to `null`. */
  private readonly draftQuery = injectQuery(() => ({
    queryKey: promptDraftQueryKey(this.repoId(), this.workspaceId()),
    enabled: this.repoId() !== null && this.workspaceId() !== null,
    queryFn: () => fetchPromptDraft(this.draftService, this.repoId()!, this.workspaceId()!),
  }));

  /**
   * The workspace's image attachments (thumbnail rows). Server-authoritative and separate from the
   * draft blob (image bytes are too big for it) — this is the read path that restores thumbnails
   * after a refresh. Refetched on the same SSE `prompt-draft` topic as the draft. Empty array when
   * none (the endpoint returns `[]`, never 404).
   */
  private readonly attachmentsQuery = injectQuery(() => ({
    queryKey: ['workspace-prompt-attachments', this.repoId(), this.workspaceId()],
    enabled: this.repoId() !== null && this.workspaceId() !== null,
    queryFn: (): Promise<WorkspacePromptAttachmentDataDto[]> =>
      lastValueFrom(
        this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftAttachmentsGet(
          this.repoId()!,
          this.workspaceId()!,
        ),
      ),
  }));

  constructor() {
    // Hydrate the images slice from the attachments query (load + SSE refetch). Unlike the draft,
    // images are server-authoritative, so this replaces the slice wholesale rather than gating on a
    // pristine/dirty flag; the guard only keeps a stale in-flight result from landing on the next
    // workspace after a switch.
    effect(() => {
      const workspaceId = this.workspaceId();
      if (
        !workspaceId ||
        workspaceId !== this.store.activeWorkspaceId() ||
        !this.attachmentsQuery.isSuccess()
      ) {
        return;
      }
      this.store.setImages((this.attachmentsQuery.data() ?? []).map((a) => toPromptImage(a)));
    });

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

  /**
   * Persist the current draft synchronously, resolving once it has hit the backend (or immediately
   * when nothing is dirty). Used before a launch that switches to the fetch model: the agent reads
   * the draft back via {@code taskPrompt}, so the debounced autosave must be flushed first or a
   * just-typed edit would race the launch and the tool would serve stale/absent text.
   *
   * <p>Unlike the debounced {@code saveNow()} loop, this <strong>does not swallow</strong> a failed
   * PUT/DELETE — the returned promise <em>rejects</em>, so the launch can abort and surface the error
   * instead of silently proceeding to fetch a stale or absent prompt. No-op (resolves) when nothing
   * is dirty.
   */
  flushNow(): Promise<void> {
    const pending = this.pendingRequest();
    if (!pending) {
      return Promise.resolve();
    }
    return lastValueFrom(
      pending.request.pipe(
        tap((res) =>
          this.store.markSaved(
            pending.kind === 'put' ? (res.updatedAt ?? null) : null,
            pending.revision,
          ),
        ),
      ),
    ).then(() => undefined);
  }

  /** Point the store + queries at a workspace; call once from the page constructor. */
  connect(repoId: string, workspaceId: string): void {
    this.store.setActiveWorkspace(workspaceId);
    this.repoId.set(repoId);
    this.workspaceId.set(workspaceId);
  }

  /**
   * Persist an image (a pasted screenshot, or a sketch export) as an attachment row and add it to the
   * images slice. The bytes live in the row, not the draft blob — the agent fetches it via {@code
   * taskPrompt}, so it reaches every launch shape. Optimistically patches the slice, then refetches
   * the GET-list to reconcile with the server (sniffed mime, stored id). A no-op before {@link
   * connect}.
   */
  async attachImage(
    dataBase64: string,
    mimeType: 'image/png' | 'image/jpeg',
    source: 'sketch' | 'paste',
  ): Promise<void> {
    const repoId = this.repoId();
    const workspaceId = this.workspaceId();
    if (!repoId || !workspaceId) {
      return;
    }
    const label = this.store.nextImageLabel(source);
    const res = await lastValueFrom(
      this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftAttachmentsPost(
        repoId,
        workspaceId,
        { mimeType, label, source: source.toUpperCase(), dataBase64 },
      ),
    );
    if (res.id) {
      this.store.addImage({ id: res.id, mimeType, label, source, dataBase64 });
    }
    await this.queryClient.invalidateQueries({
      queryKey: ['workspace-prompt-attachments', repoId, workspaceId],
    });
  }

  /** Delete an attachment row and drop it from the slice. Optimistic; refetch reconciles on failure. */
  async removeImage(id: string): Promise<void> {
    const repoId = this.repoId();
    const workspaceId = this.workspaceId();
    if (!repoId || !workspaceId) {
      return;
    }
    this.store.removeImage(id);
    try {
      await lastValueFrom(
        this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftAttachmentsAttachmentIdDelete(
          id,
          repoId,
          workspaceId,
        ),
      );
    } finally {
      await this.queryClient.invalidateQueries({
        queryKey: ['workspace-prompt-attachments', repoId, workspaceId],
      });
    }
  }

  /**
   * Delete every current attachment row — the row-cleanup half of "Discard"/clear. The caller pairs
   * this with {@code store.clear()} (which empties the slice and DELETEs the draft row via autosave);
   * deleting the rows explicitly here also covers the attachments-only case, where there is no draft
   * row for the server-side cascade to fire on. Ids are read synchronously on entry, so it is safe to
   * call just before {@code store.clear()} empties the slice.
   */
  async clearAttachments(): Promise<void> {
    const repoId = this.repoId();
    const workspaceId = this.workspaceId();
    if (!repoId || !workspaceId) {
      return;
    }
    const ids = this.store.images().map((image) => image.id);
    for (const id of ids) {
      await lastValueFrom(
        this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftAttachmentsAttachmentIdDelete(
          id,
          repoId,
          workspaceId,
        ),
      ).catch(() => undefined);
    }
    await this.queryClient.invalidateQueries({
      queryKey: ['workspace-prompt-attachments', repoId, workspaceId],
    });
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
    /**
     * The store {@link revision} captured when this request's body was built. {@code markSaved} uses
     * it to clear {@code dirty} only if no newer edit landed while the save was in flight, so an edit
     * made during the round-trip is not lost (see the store's markSaved).
     */
    revision: number;
  } | null {
    const repoId = this.repoId();
    const workspaceId = this.workspaceId();
    if (!this.store.dirty() || !repoId || !workspaceId) {
      return null;
    }
    const revision = this.store.revision();
    if (this.store.isEmpty()) {
      if (this.store.lastSavedUpdatedAt() === null) {
        return null; // empty and never saved — nothing to delete
      }
      return {
        kind: 'delete',
        revision,
        request: this.draftService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftDelete(
          repoId,
          workspaceId,
        ),
      };
    }
    return {
      kind: 'put',
      revision,
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
      tap((res) =>
        this.store.markSaved(
          pending.kind === 'put' ? (res.updatedAt ?? null) : null,
          pending.revision,
        ),
      ),
      catchError(() => EMPTY),
    );
  }

  /** Best-effort final save on teardown; subscribes without touching the store (it may now be B's). */
  private flush(): void {
    this.pendingRequest()?.request.subscribe({ error: () => undefined });
  }
}

/** Map a GET-list attachment DTO to the store's {@link PromptImage} (server enum → lowercase source). */
function toPromptImage(dto: WorkspacePromptAttachmentDataDto): PromptImage {
  return {
    id: dto.id ?? '',
    mimeType: dto.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
    label: dto.label ?? '',
    source: dto.source === PromptAttachmentSource.Sketch ? 'sketch' : 'paste',
    dataBase64: dto.dataBase64 ?? '',
  };
}
