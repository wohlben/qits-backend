import { Routes } from '@angular/router';

export const commandsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./command-list/command-list.page').then((m) => m.CommandListPage),
  },
  {
    path: ':commandId',
    loadComponent: () =>
      import('./command-terminal/command-terminal.page').then((m) => m.CommandTerminalPage),
  },
];
