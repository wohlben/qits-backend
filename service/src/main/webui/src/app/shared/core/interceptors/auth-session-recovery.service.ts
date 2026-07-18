import { Injectable } from '@angular/core';
import { appUrl } from '@/shared/utils/app-base';

/** Survives reloads within the tab, so a reload that failed to re-login is detectable. */
const RELOAD_STAMP_KEY = 'qits.auth.reload-at';

/** A second 499-reload this soon after the last one means reloading isn't recovering the session. */
const RAPID_REPEAT_WINDOW_MS = 10_000;

/**
 * Breaks the expired-OIDC-session reload loop (docs/issues/resolved/
 * 2026-07-18_oidc-expired-session-reload-loop.md). A dead session 499s every in-flight query at
 * once, and each used to trigger its own unconditional `window.location.reload()` — with nothing
 * remembering that the previous reload already failed to bring a session back.
 *
 * Two guards: a per-page-life latch (one navigation per incident, however many 499s burst in), and
 * a sessionStorage stamp across reloads — if the last 499-reload was moments ago, reloading the
 * same deep route again would just re-fire the burst, so escape to the app root instead. That
 * top-level entry is a single clean document navigation with no SPA traffic racing the code flow —
 * the same thing closing and reopening the tab achieves, minus the closing.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionRecoveryService {
  private recovering = false;

  /** React to a 499 ("re-login needed"): navigate exactly once, and never into a loop. */
  recover(): void {
    if (this.recovering) {
      return;
    }
    this.recovering = true;
    const now = Date.now();
    const lastReloadAt = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? '0');
    if (now - lastReloadAt < RAPID_REPEAT_WINDOW_MS) {
      sessionStorage.removeItem(RELOAD_STAMP_KEY); // next incident starts fresh
      this.navigate(appUrl(''));
      return;
    }
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
    this.reload();
  }

  /** Test seam — jsdom can't navigate. */
  reload(): void {
    window.location.reload();
  }

  /** Test seam — jsdom can't navigate. */
  navigate(url: string): void {
    window.location.assign(url);
  }
}
