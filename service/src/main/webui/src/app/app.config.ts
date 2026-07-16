import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';

import { routes } from './app.routes';
import { provideZard } from '@/shared/core/provider/providezard';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental'
import { provideApi } from './api/provide-api';
import { authSessionInterceptor } from '@/shared/core/interceptors/auth-session.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authSessionInterceptor])),
    provideZard(),
    provideTanStackQuery(new QueryClient()),
    provideApi('')
  ]
};
