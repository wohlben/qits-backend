import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, RouteReuseStrategy } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideQitsIntegration, withFeatureCapture } from '@qits/angular';

import { routes } from './app.routes';
import { provideZard } from '@/shared/core/provider/providezard';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental'
import { provideApi } from './api/provide-api';
import { appBasePath } from '@/shared/utils/app-base';
import { authSessionInterceptor } from '@/shared/core/interceptors/auth-session.interceptor';
import { ParamRemountRouteReuseStrategy } from '@/shared/core/routing/param-remount-route-reuse.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Default reuse everywhere, except routes opting into `data.remountParams` (the workspace
    // detail matcher): those remount on an identity-param change so snapshot-read pages reload.
    { provide: RouteReuseStrategy, useClass: ParamRemountRouteReuseStrategy },
    // Telemetry ErrorHandler + navigation spans + app.route.* stamping; no-op when dark (the
    // standalone case — config.json reports telemetry: null without a supervising qits).
    // withFeatureCapture: the floaty capture button, gated by config.json's capture relay.
    provideQitsIntegration(withFeatureCapture()),
    // withFetch: the OTEL fetch instrumentation only sees fetch()-based requests — this is what
    // gives API calls a client span and traceparent propagation into the backend trace.
    provideHttpClient(withFetch(), withInterceptors([authSessionInterceptor])),
    provideZard(),
    provideTanStackQuery(new QueryClient()),
    // Base-relative API root: '' at root (today's behavior), the /daemon/{ws}/{d} prefix framed.
    provideApi(appBasePath())
  ]
};
