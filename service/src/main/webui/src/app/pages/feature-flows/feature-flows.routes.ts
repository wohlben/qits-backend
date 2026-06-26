import { Routes } from '@angular/router';

export const featureFlowsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./feature-flow-list/feature-flow-list.page').then((m) => m.FeatureFlowListPage),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./feature-flow-detail/feature-flow-detail.page').then((m) => m.FeatureFlowDetailPage),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./feature-flow-form/feature-flow-form.page').then((m) => m.FeatureFlowFormPage),
  },
];
