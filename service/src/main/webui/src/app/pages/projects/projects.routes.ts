import { Routes } from '@angular/router';

export const projectsRoutes: Routes = [
  { path: '', loadComponent: () => import('./project-list/project-list.page').then((m) => m.ProjectListPage) },
  { path: 'new', loadComponent: () => import('./project-form/project-form.page').then((m) => m.ProjectFormPage) },
  { path: ':id', loadComponent: () => import('./project-detail/project-detail.page').then((m) => m.ProjectDetailPage) },
  { path: ':id/edit', loadComponent: () => import('./project-form/project-form.page').then((m) => m.ProjectFormPage) },
  { path: ':projectId/repositories/new', loadComponent: () => import('./project-repository-new/project-repository-new.page').then((m) => m.ProjectRepositoryNewPage) },
  { path: ':projectId/feature-flows/new', loadComponent: () => import('./project-feature-flow-new/project-feature-flow-new.page').then((m) => m.ProjectFeatureFlowNewPage) },
];
