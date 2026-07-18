import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AuthControllerService } from '@/api/api/authController.service';
import { appUrl } from '@/shared/utils/app-base';

/**
 * The signed-in identity chip + sign-out link for the sidebar. Every build variant is
 * authenticated, so the chip renders whenever `/api/auth/me` reports an identity (under
 * forwardauth in dev mode that's the synthetic `dev` fallback user). The sign-out link exists only
 * in the oauth variant — forwardauth has no qits-side logout, the proxy owns the session — and is a
 * real anchor (full navigation, not routerLink): `/api/auth/logout` is intercepted server-side by
 * quarkus-oidc for the RP-initiated Keycloak logout.
 */
@Component({
  selector: 'app-auth-status',
  template: `
    @if (authQuery.data()?.username) {
      <div class="flex flex-col gap-1 px-2 text-sm" [class.items-center]="collapsed()">
        @if (!collapsed()) {
          <span class="truncate text-muted-foreground" [title]="authQuery.data()?.username">
            {{ authQuery.data()?.username }}
          </span>
        }
        @if (authQuery.data()?.variant === 'oauth') {
          <a
            [href]="logoutHref"
            class="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            [title]="collapsed() ? 'Sign out' : ''"
          >
            {{ collapsed() ? '⏻' : 'Sign out' }}
          </a>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthStatusComponent {
  readonly collapsed = input(false);

  /** Base-relative so the server-side logout intercept still matches under a path prefix. */
  protected readonly logoutHref = appUrl('api/auth/logout');

  private readonly authService = inject(AuthControllerService);

  readonly authQuery = injectQuery(() => ({
    queryKey: ['auth', 'me'],
    queryFn: () => lastValueFrom(this.authService.apiAuthMeGet()),
    staleTime: Infinity, // whether auth is on and who's logged in can't change without a reload
  }));
}
