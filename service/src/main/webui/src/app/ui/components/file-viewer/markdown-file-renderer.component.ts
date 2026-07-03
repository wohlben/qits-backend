import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';
import { resolveRelativeLink } from './resolve-relative-link';

/**
 * Presentational: the "rendered" smart view for markdown files in the file viewer. Wraps the
 * chat's {@link MarkdownComponent} in a document reading width and intercepts link clicks:
 * external links open in a new tab; relative links resolve against the current file's directory
 * and are emitted via {@link openLink} so the file browser can open them in its tree. The
 * interceptor is load-bearing — Angular's sanitizer keeps relative hrefs, so an unhandled click
 * would navigate the SPA to a dead URL. Anchor-only links are swallowed: headings carry no ids
 * (marked v18 emits none, and enabling them would change chat rendering too).
 */
@Component({
  selector: 'app-markdown-file-renderer',
  imports: [MarkdownComponent],
  host: { '(click)': 'onClick($event)' },
  template: `
    <div class="mx-auto w-full max-w-[80ch] px-6 py-4">
      <app-markdown [text]="content()" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownFileRendererComponent {
  /** The file's markdown source. */
  readonly content = input.required<string>();
  /** Repo-relative path of the file being shown — the base for relative-link resolution. */
  readonly path = input.required<string>();

  /** A relative link, resolved to the repo-relative path the user wants to open. */
  readonly openLink = output<string>();

  protected onClick(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor) {
      return;
    }
    // The `href` property is browser-absolutized; the attribute keeps the authored value.
    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }

    if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
      event.preventDefault();
      window.open(href, '_blank', 'noopener');
      return;
    }
    if (href.startsWith('#')) {
      event.preventDefault();
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      return; // mailto: and friends — leave the browser default
    }
    event.preventDefault();
    const target = resolveRelativeLink(this.path(), href);
    if (target !== null) {
      this.openLink.emit(target);
    }
  }
}
