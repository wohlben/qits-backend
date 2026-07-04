import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/main-layout/main-layout.component').then(m => m.MainLayoutComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage),
      },
      {
        path: 'projects',
        loadChildren: () => import('./pages/projects/projects.routes').then(m => m.projectsRoutes),
      },
      {
        path: 'repositories',
        loadChildren: () => import('./pages/repositories/repositories.routes').then(m => m.repositoriesRoutes),
      },
      {
        path: 'commands',
        loadChildren: () => import('./pages/commands/commands.routes').then(m => m.commandsRoutes),
      },
      {
        path: 'action-configurations',
        loadChildren: () => import('./pages/action-configurations/action-configurations.routes').then(m => m.actionConfigurationsRoutes),
      },
      {
        path: 'daemon-configurations',
        loadChildren: () => import('./pages/daemon-configurations/daemon-configurations.routes').then(m => m.daemonConfigurationsRoutes),
      },
      {
        path: 'feature-flows',
        loadChildren: () => import('./pages/feature-flows/feature-flows.routes').then(m => m.featureFlowsRoutes),
      },
    ],
  },
];
