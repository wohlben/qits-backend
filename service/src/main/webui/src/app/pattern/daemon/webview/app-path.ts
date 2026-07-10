/**
 * Mapping between the framed app's own routes ("app-side paths", e.g. `/greeting?tab=2`) and the
 * daemon web-view proxy URLs that serve them (`/daemon/{workspaceId}/{daemonId}/greeting?tab=2`).
 * The URL bar displays and accepts the app-side form — the user edits the app's URL, not the
 * proxy's — and navigation must stay inside the proxy prefix or the same-origin picker (and the
 * URL bar itself) breaks on a foreign document.
 */

/** A parsed URL-bar input: either the normalized app-side path, or why it can't be applied. */
export type AppPathParse = { appPath: string } | { error: string };

const OUTSIDE_PROXY_ERROR = "outside this daemon's web view";

/**
 * Normalizes URL-bar input to an app-side path. Accepted forms: an app-side path (leading slash
 * optional), this daemon's proxy path, or a full URL that resolves inside this daemon's proxy
 * prefix on this origin. A URL or `/daemon/…` path pointing anywhere else is rejected — it would
 * either leave the same-origin proxy or be silently reinterpreted as an app route.
 */
export function parseAppPath(input: string, proxyPath: string, origin: string): AppPathParse {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return { error: 'not a valid URL' };
    }
    if (url.origin !== origin) {
      return { error: OUTSIDE_PROXY_ERROR };
    }
    const appPath = stripProxyPrefix(trimmed, proxyPath);
    return appPath == null ? { error: OUTSIDE_PROXY_ERROR } : { appPath };
  }
  if (trimmed.startsWith(proxyPath) || trimmed + '/' === proxyPath) {
    const appPath = stripProxyPrefix(origin + trimmed, proxyPath);
    return appPath == null ? { error: OUTSIDE_PROXY_ERROR } : { appPath };
  }
  if (trimmed.startsWith('/daemon/')) {
    return { error: OUTSIDE_PROXY_ERROR };
  }
  return { appPath: trimmed.startsWith('/') ? trimmed : '/' + trimmed };
}

/** The proxy URL serving an app-side path — proxyPath is trailing-slashed, so a plain join. */
export function toProxyUrl(appPath: string, proxyPath: string): string {
  return proxyPath + appPath.replace(/^\/+/, '');
}

/**
 * The app-side path (route + query + hash) of a framed document's URL, or null when the URL does
 * not live under this daemon's proxy prefix.
 */
export function stripProxyPrefix(href: string, proxyPath: string): string | null {
  let url: URL;
  try {
    // the base only matters for path-only hrefs; an absolute href keeps its own origin
    url = new URL(href, 'http://qits.invalid');
  } catch {
    return null;
  }
  if (url.pathname + '/' === proxyPath) {
    return '/' + url.search + url.hash;
  }
  if (!url.pathname.startsWith(proxyPath)) {
    return null;
  }
  return '/' + url.pathname.slice(proxyPath.length) + url.search + url.hash;
}
