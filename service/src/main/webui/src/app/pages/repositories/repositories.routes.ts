import { Routes } from '@angular/router';

export const repositoriesRoutes: Routes = [
  {
    path: ':repoId',
    loadComponent: () =>
      import('./repository-detail/repository-detail.page').then((m) => m.RepositoryDetailPage),
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
    path: ':repoId/worktrees/:worktreeId',
    loadComponent: () =>
      import('./worktree-detail/worktree-detail.page').then((m) => m.WorktreeDetailPage),
  },
  {
    path: ':repoId/worktrees/:worktreeId/wip',
    loadComponent: () =>
      import('./worktree-wip/worktree-wip.page').then((m) => m.WorktreeWipPage),
  },
  {
    path: ':repoId/history',
    loadComponent: () =>
      import('./worktree-history/worktree-history.page').then((m) => m.WorktreeHistoryPage),
  },
  {
    path: ':repoId/history/:id',
    loadComponent: () =>
      import('./worktree-history-detail/worktree-history-detail.page').then(
        (m) => m.WorktreeHistoryDetailPage,
      ),
  },
];
