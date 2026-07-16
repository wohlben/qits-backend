import { HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/**
 * OIDC session support for the oauth build variant (a harmless header-tagger under forwardauth,
 * whose backend never answers 499).
 *
 * Marks same-origin API calls with `X-Requested-With: JavaScript` so an expired OIDC session
 * answers 499 + `WWW-Authenticate: OIDC` instead of a 302 to Keycloak that XHR cannot follow
 * (`quarkus.oidc.authentication.java-script-auto-redirect=false`). A 499 means "re-login needed":
 * a full-page reload hands navigation to the server, which turns it into the code-flow redirect
 * and lands the user back where they were.
 */
export const authSessionInterceptor: HttpInterceptorFn = (req, next) => {
  const marked = req.url.startsWith('http')
    ? req // never decorate absolute/cross-origin URLs
    : req.clone({ setHeaders: { 'X-Requested-With': 'JavaScript' } });
  return next(marked).pipe(
    catchError((err: unknown) => {
      if ((err as { status?: number })?.status === 499) {
        window.location.reload();
      }
      return throwError(() => err);
    })
  );
};
