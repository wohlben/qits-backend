/**
 * Base-path helpers for the raw-URL escape hatches (EventSource, WebSocket, real anchors, the
 * generated API client's basePath) that can't ride Angular's <base>-relative routing on their own.
 *
 * Under a supervising qits' daemon web view the app is served at /daemon/{ws}/{daemonId}/ and the
 * index.html inline script rebases <base href> to that prefix — `document.baseURI` is therefore
 * the one source of truth for where the app lives. At root these helpers collapse to today's
 * absolute paths, so the standalone deployment is byte-identical.
 */

/** The app's base path without a trailing slash — `''` at root, `/daemon/{ws}/{d}` framed. */
export function appBasePath(): string {
  const base = new URL(document.baseURI).pathname;
  return base === '/' ? '' : base.replace(/\/$/, '');
}

/** An absolute path inside the app's base: `appUrl('api/auth/me')` → `/api/auth/me` at root. */
export function appUrl(path: string): string {
  return `${appBasePath()}/${path}`;
}

/** An absolute ws(s):// URL inside the app's base, for the raw WebSocket call sites. */
export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${appUrl(path)}`;
}
