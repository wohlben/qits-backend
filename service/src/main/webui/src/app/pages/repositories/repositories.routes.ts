import { Routes } from '@angular/router';

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
    path: ':repoId/workspaces/:workspaceId',
    loadComponent: () =>
      import('./workspace-detail/workspace-detail.page').then((m) => m.WorkspaceDetailPage),
  },
  {
    path: ':repoId/workspaces/:workspaceId/wip',
    loadComponent: () =>
      import('./workspace-wip/workspace-wip.page').then((m) => m.WorkspaceWipPage),
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
