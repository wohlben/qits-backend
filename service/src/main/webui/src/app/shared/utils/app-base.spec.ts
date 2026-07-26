import { describe, expect, it, afterEach } from 'vitest';

import { appBasePath, appUrl, wsUrl } from './app-base';

/** Points document.baseURI at the given href via a real <base> element. */
function setBaseHref(href: string): void {
  let base = document.querySelector('base');
  if (!base) {
    base = document.createElement('base');
    document.head.appendChild(base);
  }
  base.setAttribute('href', href);
}

describe('app-base', () => {
  afterEach(() => {
    document.querySelector('base')?.remove();
  });

  it('collapses to the plain absolute path at root', () => {
    setBaseHref('/');
    expect(appBasePath()).toBe('');
    expect(appUrl('api/auth/me')).toBe('/api/auth/me');
  });

  it('prefixes the service web-view base', () => {
    setBaseHref('/service/ws-1/d-1/');
    expect(appBasePath()).toBe('/service/ws-1/d-1');
    expect(appUrl('api/auth/me')).toBe('/service/ws-1/d-1/api/auth/me');
  });

  it('builds ws URLs on the current host inside the base', () => {
    setBaseHref('/service/ws-1/d-1/');
    const url = wsUrl('api/chat/commands/c-1');
    expect(url).toBe(`ws://${window.location.host}/service/ws-1/d-1/api/chat/commands/c-1`);
  });
});
