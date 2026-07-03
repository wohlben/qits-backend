import type { Type } from '@angular/core';

import { MarkdownFileRendererComponent } from './markdown-file-renderer.component';

/** A "smart display" for a file type: a rendered alternative to the plain source view. */
export interface SmartRenderer {
  /** Stable id — also the key under which the user's rendered/source choice is remembered. */
  id: string;
  matches(path: string): boolean;
  /** The rendered view. Currently mounted via an `@if` branch in the file viewer. */
  component: Type<unknown>;
}

const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;

/** All smart renderers, in priority order (first match wins). */
export const SMART_RENDERERS: readonly SmartRenderer[] = [
  {
    id: 'markdown',
    matches: (path) => MARKDOWN_EXTENSIONS.test(path),
    component: MarkdownFileRendererComponent,
  },
];

/** The renderer responsible for `path`, if any. */
export function findRenderer(path: string): SmartRenderer | undefined {
  return SMART_RENDERERS.find((renderer) => renderer.matches(path));
}
