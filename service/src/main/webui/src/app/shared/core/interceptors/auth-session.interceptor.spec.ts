import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authSessionInterceptor } from './auth-session.interceptor';
import { AuthSessionRecoveryService } from './auth-session-recovery.service';

const RELOAD_STAMP_KEY = 'qits.auth.reload-at';

describe('authSessionInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let recovery: AuthSessionRecoveryService;
  let reload: ReturnType<typeof vi.spyOn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authSessionInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    recovery = TestBed.inject(AuthSessionRecoveryService);
    // jsdom can't navigate — stub the seams and assert on them.
    reload = vi.spyOn(recovery, 'reload').mockImplementation(() => {});
    navigate = vi.spyOn(recovery, 'navigate').mockImplementation(() => {});
  });

  function fire499(url: string): void {
    http.get(url).subscribe({ error: () => {} });
    backend.expectOne(url).flush('', { status: 499, statusText: 'Auth Required' });
  }

  it('marks same-origin requests with the XHR header, but never absolute URLs', () => {
    http.get('api/dummy').subscribe({ error: () => {} });
    const relative = backend.expectOne('api/dummy');
    expect(relative.request.headers.get('X-Requested-With')).toBe('JavaScript');
    relative.flush({});

    http.get('https://example.org/x').subscribe({ error: () => {} });
    const absolute = backend.expectOne('https://example.org/x');
    expect(absolute.request.headers.has('X-Requested-With')).toBe(false);
    absolute.flush({});

    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once on the first 499 and stamps the incident', () => {
    fire499('api/one');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_STAMP_KEY)).not.toBeNull();
  });

  it('latches: a burst of 499s triggers a single navigation per page life', () => {
    fire499('api/one');
    fire499('api/two');
    fire499('api/three');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('escapes to the app root when the previous reload moments ago did not recover the session', () => {
    // A fresh page life (this TestBed) that finds a just-written stamp = the post-reload SPA
    // getting 499s again — reloading the deep route once more would loop.
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now() - 1000));
    fire499('api/one');
    expect(reload).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/');
    // The stamp is cleared so the *next* incident starts with a normal reload again.
    expect(sessionStorage.getItem(RELOAD_STAMP_KEY)).toBeNull();
  });

  it('reloads normally when the last incident is long past', () => {
    sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now() - 60_000));
    fire499('api/one');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ignores non-499 errors', () => {
    http.get('api/fail').subscribe({ error: () => {} });
    backend.expectOne('api/fail').flush('', { status: 500, statusText: 'Boom' });
    expect(reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
