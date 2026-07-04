import { Routes } from '@angular/router';

export const daemonConfigurationsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./daemon-configuration-list/daemon-configuration-list.page').then(
        (m) => m.DaemonConfigurationListPage,
      ),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./daemon-configuration-form/daemon-configuration-form.page').then(
        (m) => m.DaemonConfigurationFormPage,
      ),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./daemon-configuration-form/daemon-configuration-form.page').then(
        (m) => m.DaemonConfigurationFormPage,
      ),
  },
];
