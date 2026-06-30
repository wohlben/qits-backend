import { Routes } from '@angular/router';

export const commandsRoutes: Routes = [
  {
    path: ':commandId',
    loadComponent: () =>
      import('./command-terminal/command-terminal.page').then((m) => m.CommandTerminalPage),
  },
];
