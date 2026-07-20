import { catchError, lastValueFrom, of } from 'rxjs';

import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { WorkspacePromptDraftDto } from '@/api/model/workspacePromptDraftDto';

/**
 * The TanStack query key for a workspace's persisted prompt draft. Shared by every reader
 * ({@code PromptDraftSyncService} hydrate/autosave and the Agents tab's un-run-draft check) so they
 * hit a single cache entry — a fetch on one populates the other, and the SSE {@code prompt-draft}
 * invalidation refreshes both.
 */
export function promptDraftQueryKey(repoId: string | null, workspaceId: string | null) {
  return ['workspace-prompt-draft', repoId, workspaceId] as const;
}

/**
 * Fetch a workspace's prompt draft, mapping 404 (never saved) to {@code null}. The shared queryFn
 * body so the missing-draft contract can't drift between the sync service and the Agents tab.
 */
export function fetchPromptDraft(
  service: WorkspacePromptDraftControllerService,
  repoId: string,
  workspaceId: string,
): Promise<WorkspacePromptDraftDto | null> {
  return lastValueFrom(
    service.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet(repoId, workspaceId).pipe(
      catchError((err: unknown) => {
        if (err && typeof err === 'object' && (err as { status?: number }).status === 404) {
          return of(null);
        }
        throw err;
      }),
    ),
  );
}
