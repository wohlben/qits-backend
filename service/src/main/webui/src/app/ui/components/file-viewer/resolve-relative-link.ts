/**
 * Resolves a markdown `href` against the directory of the current repo-relative file path.
 *
 * Returns the normalized repo-relative target, or `null` when the href isn't an in-repo file
 * link: external (`http:`, `//…`, `mailto:`, any scheme), anchor-only (`#section`), or a path
 * that escapes the repo root.
 */
export function resolveRelativeLink(currentPath: string, href: string): string | null {
  // Resolve files, not anchors — drop any fragment and query.
  const bare = href.split('#')[0].split('?')[0];
  if (bare === '') {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(bare) || bare.startsWith('//')) {
    return null;
  }

  // A leading slash means repo-root-relative; otherwise resolve against the file's directory.
  const lastSlash = currentPath.lastIndexOf('/');
  const baseDir = bare.startsWith('/') || lastSlash === -1 ? '' : currentPath.slice(0, lastSlash);

  const segments = baseDir === '' ? [] : baseDir.split('/');
  for (const raw of bare.split('/')) {
    if (raw === '' || raw === '.') {
      continue;
    }
    if (raw === '..') {
      if (segments.length === 0) {
        return null; // escapes the repo root
      }
      segments.pop();
      continue;
    }
    try {
      segments.push(decodeURIComponent(raw)); // e.g. `%20` in filenames
    } catch {
      return null; // malformed percent-encoding
    }
  }
  return segments.length === 0 ? null : segments.join('/');
}
