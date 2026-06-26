import { Routes } from '@angular/router';

export const actionConfigurationsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./action-configuration-list/action-configuration-list.page').then((m) => m.ActionConfigurationListPage),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./action-configuration-form/action-configuration-form.page').then((m) => m.ActionConfigurationFormPage),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./action-configuration-detail/action-configuration-detail.page').then((m) => m.ActionConfigurationDetailPage),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./action-configuration-form/action-configuration-form.page').then((m) => m.ActionConfigurationFormPage),
  },
];
