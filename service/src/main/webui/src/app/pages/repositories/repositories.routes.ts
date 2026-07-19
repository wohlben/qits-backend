import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';

/**
 * `:repoId/workspaces/:workspaceId(/:tab)?` as ONE route config — the optional trailing segment
 * selects the detail page's active tab, and a single config means tab navigation never remounts
 * the page (the chat socket, web-view iframe, and scroll positions survive; two route entries
 * would fail Angular's default reuse check on every bare↔slugged transition). Any non-`wip`
 * 4th segment is accepted so unknown slugs still reach the page, which normalizes them away;
 * `wip` is reserved for the legacy speak-to-prompt page below.
 */
export function workspaceDetailMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length < 3 || segments.length > 4 || segments[1].path !== 'workspaces') {
    return null;
  }
  if (segments.length === 4 && segments[3].path === 'wip') {
    return null;
  }
  const posParams: Record<string, UrlSegment> = { repoId: segments[0], workspaceId: segments[2] };
  if (segments.length === 4) {
    posParams['tab'] = segments[3];
  }
  return { consumed: segments, posParams };
}

export const repositoriesRoutes: Routes = [
  {
    path: ':repoId',
    loadComponent: () =>
      import('./repository-detail/repository-detail.page').then((m) => m.RepositoryDetailPage),
  },
  {
    path: ':repoId/daemons',
    loadComponent: () =>
      import('./repository-daemons/repository-daemons.page').then((m) => m.RepositoryDaemonsPage),
  },
  {
    path: ':repoId/daemons/new',
    loadComponent: () =>
      import('./repository-daemon-form/repository-daemon-form.page').then(
        (m) => m.RepositoryDaemonFormPage,
      ),
  },
  {
    path: ':repoId/daemons/:daemonId/edit',
    loadComponent: () =>
      import('./repository-daemon-form/repository-daemon-form.page').then(
        (m) => m.RepositoryDaemonFormPage,
      ),
  },
  {
    path: ':repoId/bootstrap',
    loadComponent: () =>
      import('./repository-bootstrap/repository-bootstrap.page').then(
        (m) => m.RepositoryBootstrapPage,
      ),
  },
  {
    path: ':repoId/bootstrap/new',
    loadComponent: () =>
      import('./repository-bootstrap-form/repository-bootstrap-form.page').then(
        (m) => m.RepositoryBootstrapFormPage,
      ),
  },
  {
    path: ':repoId/bootstrap/:commandId/edit',
    loadComponent: () =>
      import('./repository-bootstrap-form/repository-bootstrap-form.page').then(
        (m) => m.RepositoryBootstrapFormPage,
      ),
  },
  {
    path: ':repoId/branch/:branchName/commits',
    loadComponent: () =>
      import('./branch-commits/branch-commits.page').then((m) => m.BranchCommitsPage),
  },
  {
    path: ':repoId/branch/:branchName/commits/:commitHash',
    loadComponent: () =>
      import('./commit-detail/commit-detail.page').then((m) => m.CommitDetailPage),
  },
  {
    path: ':repoId/workspaces/:workspaceId/wip',
    loadComponent: () =>
      import('./workspace-wip/workspace-wip.page').then((m) => m.WorkspaceWipPage),
  },
  {
    matcher: workspaceDetailMatcher,
    loadComponent: () =>
      import('./workspace-detail/workspace-detail.page').then((m) => m.WorkspaceDetailPage),
  },
  {
    path: ':repoId/history',
    loadComponent: () =>
      import('./workspace-history/workspace-history.page').then((m) => m.WorkspaceHistoryPage),
  },
  {
    path: ':repoId/history/:id',
    loadComponent: () =>
      import('./workspace-history-detail/workspace-history-detail.page').then(
        (m) => m.WorkspaceHistoryDetailPage,
      ),
  },
];
