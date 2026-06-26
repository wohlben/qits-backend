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
    path: ':repoId/branch/:branchName/terminal',
    loadComponent: () =>
      import('./branch-terminal/branch-terminal.page').then((m) => m.BranchTerminalPage),
  },
];
