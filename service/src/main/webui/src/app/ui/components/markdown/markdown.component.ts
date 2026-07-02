import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { marked } from 'marked';

/**
 * Presentational: renders a markdown string as HTML. Used for chat messages (both the human's turns
 * and Claude's responses). The parsed HTML is bound via `[innerHTML]`, so Angular's built-in
 * DomSanitizer strips anything unsafe (scripts, event handlers, `javascript:` URLs) — we never
 * bypass it.
 *
 * Styling uses `ViewEncapsulation.None` because emulated encapsulation can't reach nodes inserted
 * through `[innerHTML]`; every rule is namespaced under `.qits-md` and uses `currentColor` so the
 * same styles read correctly on both the light user bubble and the muted assistant bubble.
 */
@Component({
  selector: 'app-markdown',
  template: `<div class="qits-md" [innerHTML]="html()"></div>`,
  styles: [
    `
      .qits-md > :first-child {
        margin-top: 0;
      }
      .qits-md > :last-child {
        margin-bottom: 0;
      }
      .qits-md p,
      .qits-md ul,
      .qits-md ol,
      .qits-md blockquote,
      .qits-md pre,
      .qits-md table {
        margin: 0.5em 0;
      }
      .qits-md ul,
      .qits-md ol {
        padding-left: 1.5em;
      }
      .qits-md ul {
        list-style: disc;
      }
      .qits-md ol {
        list-style: decimal;
      }
      .qits-md li {
        margin: 0.15em 0;
      }
      .qits-md h1,
      .qits-md h2,
      .qits-md h3,
      .qits-md h4 {
        font-weight: 600;
        line-height: 1.3;
        margin: 0.75em 0 0.4em;
      }
      .qits-md h1 {
        font-size: 1.3em;
      }
      .qits-md h2 {
        font-size: 1.2em;
      }
      .qits-md h3 {
        font-size: 1.1em;
      }
      .qits-md a {
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .qits-md code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.9em;
        background: color-mix(in srgb, currentColor 12%, transparent);
        padding: 0.1em 0.3em;
        border-radius: 0.25rem;
      }
      .qits-md pre {
        background: color-mix(in srgb, currentColor 10%, transparent);
        padding: 0.75em;
        border-radius: 0.375rem;
        overflow-x: auto;
      }
      .qits-md pre code {
        background: transparent;
        padding: 0;
        font-size: 0.85em;
      }
      .qits-md blockquote {
        border-left: 3px solid color-mix(in srgb, currentColor 25%, transparent);
        padding-left: 0.75em;
        opacity: 0.85;
      }
      .qits-md table {
        border-collapse: collapse;
        display: block;
        overflow-x: auto;
      }
      .qits-md th,
      .qits-md td {
        border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        padding: 0.3em 0.6em;
        text-align: left;
      }
      .qits-md hr {
        border: 0;
        border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
        margin: 0.75em 0;
      }
      .qits-md img {
        max-width: 100%;
      }
    `,
  ],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownComponent {
  readonly text = input.required<string>();

  protected readonly html = computed(() =>
    marked.parse(this.text(), { gfm: true, breaks: true, async: false }),
  );
}
