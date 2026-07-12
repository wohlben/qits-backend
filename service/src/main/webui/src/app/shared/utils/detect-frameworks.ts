/**
 * Presentation helpers for framework detection. The detection itself — which projects a workspace
 * holds, each framework's membership set, and the source↔test link graph — is now computed
 * **server-side** and delivered by `GET .../{workspaceId}/detection` (see the backend
 * `FrameworkDetectionService` / `DetectionService`). This module keeps only what the *client* owns:
 * mapping a framework's open string id (and its already-refined label) to an icon and a landing
 * directory. Unknown ids degrade gracefully (no icon), which is the whole point of the open-id seam.
 */

/** A file in a viewer "linked group": the opened file plus its detected counterpart(s). */
export interface LinkedFile {
  role: 'code' | 'test';
  path: string;
}

/**
 * The framework icon painted on a detected project's root folder node, or `null` for the repo root
 * / an unknown framework. Java shows the Quarkus mark or the plain Java cup depending on the
 * server-refined label (`Java / Quarkus` vs `Java / Maven`); Angular the shield.
 */
export function frameworkRootIcon(frameworkId: string, label: string): string | null {
  if (frameworkId === 'ts-angular') return '/angular.svg';
  if (frameworkId === 'java-quarkus') return label.includes('Quarkus') ? '/quarkus.svg' : '/java.svg';
  return null;
}

/**
 * The directory a quick-access toggle opens the tree down to (its ancestors are opened too), so
 * activating a framework lands the user inside its source tree instead of at the collapsed root —
 * java → `<root>/src/main`, angular → `<root>/src`, docs → the docs dir itself. `null` = don't
 * auto-open (unknown framework).
 */
export function autoExpandDir(frameworkId: string, root: string): string | null {
  switch (frameworkId) {
    case 'java-quarkus':
      return root === '' ? 'src/main' : `${root}/src/main`;
    case 'ts-angular':
      return root === '' ? 'src' : `${root}/src`;
    case 'docs':
      return root || null;
    default:
      return null;
  }
}
