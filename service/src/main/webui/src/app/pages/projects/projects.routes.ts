import { Routes } from '@angular/router';

export const projectsRoutes: Routes = [
  { path: '', loadComponent: () => import('./project-list/project-list.page').then((m) => m.ProjectListPage) },
  { path: 'new', loadComponent: () => import('./project-form/project-form.page').then((m) => m.ProjectFormPage) },
  { path: ':id', loadComponent: () => import('./project-detail/project-detail.page').then((m) => m.ProjectDetailPage) },
  { path: ':id/edit', loadComponent: () => import('./project-form/project-form.page').then((m) => m.ProjectFormPage) },
  { path: ':projectId/repositories/new', loadComponent: () => import('./project-repository-new/project-repository-new.page').then((m) => m.ProjectRepositoryNewPage) },
  { path: ':projectId/feature-flows/new', loadComponent: () => import('./project-feature-flow-new/project-feature-flow-new.page').then((m) => m.ProjectFeatureFlowNewPage) },
  { path: ':projectId/epics/new', loadComponent: () => import('./epic-form/epic-form.page').then((m) => m.EpicFormPage) },
  { path: ':projectId/epics/:epicId', loadComponent: () => import('./epic-detail/epic-detail.page').then((m) => m.EpicDetailPage) },
  { path: ':projectId/epics/:epicId/edit', loadComponent: () => import('./epic-form/epic-form.page').then((m) => m.EpicFormPage) },
  { path: ':projectId/epics/:epicId/features/new', loadComponent: () => import('./feature-form/feature-form.page').then((m) => m.FeatureFormPage) },
  { path: ':projectId/epics/:epicId/features/:featureId', loadComponent: () => import('./feature-detail/feature-detail.page').then((m) => m.FeatureDetailPage) },
  { path: ':projectId/epics/:epicId/features/:featureId/edit', loadComponent: () => import('./feature-form/feature-form.page').then((m) => m.FeatureFormPage) },
  { path: ':projectId/epics/:epicId/features/:featureId/tasks/new', loadComponent: () => import('./task-form/task-form.page').then((m) => m.TaskFormPage) },
  { path: ':projectId/epics/:epicId/features/:featureId/tasks/:taskId', loadComponent: () => import('./task-detail/task-detail.page').then((m) => m.TaskDetailPage) },
  { path: ':projectId/epics/:epicId/features/:featureId/tasks/:taskId/edit', loadComponent: () => import('./task-form/task-form.page').then((m) => m.TaskFormPage) },
];
