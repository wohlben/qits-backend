import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { FileViewerComponent } from './file-viewer.component';

/**
 * Visual regression for the rendered-markdown file view (reading width, `.qits-md` document
 * styles, the Preview/Code toggle) in light and dark, run in a real headless Chromium via
 * Vitest browser mode (`ng run qits-ui:test-visual`). Baseline PNGs live under
 * `__screenshots__/`; the run fails on pixel drift, so a human and the agent inspect identical
 * graphics. Source mode is deliberately not screenshotted — CodeMirror's async grammar loading
 * makes it flaky.
 */

const README = `# qits

Manages Git repositories, worktrees and *feature flow* configurations.

## Getting started

1. Build the modules: \`./mvnw install -DskipTests\`
2. Start dev mode
3. Open the [architecture notes](./docs/architecture.md)

> All state lives in a shared H2 file — no Docker needed.

| Module  | Purpose            |
| ------- | ------------------ |
| domain  | business core      |
| service | web app + UI       |
| cli     | seed & migrations  |

\`\`\`java
public class Main {
  public static void main(String[] args) {}
}
\`\`\`
`;

@Component({
  imports: [FileViewerComponent],
  template: `
    <div
      [attr.data-testid]="testId()"
      [class]="'bg-background p-6 text-foreground ' + (dark() ? 'dark' : '')"
      style="width: 780px; height: 640px"
    >
      <app-file-viewer path="README.md" [content]="readme" [isDark]="dark()" />
    </div>
  `,
})
class ViewerHost {
  readonly testId = input.required<string>();
  readonly dark = input(false);
  readonly readme = README;
}

describe('FileViewerComponent (visual)', () => {
  async function renderHost(testId: string, dark: boolean) {
    const fixture = TestBed.createComponent(ViewerHost);
    fixture.componentRef.setInput('testId', testId);
    fixture.componentRef.setInput('dark', dark);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('renders a README as a document with the mode toggle (light)', async () => {
    await renderHost('viewer-light', false);
    await expect.element(page.getByTestId('viewer-light')).toMatchScreenshot('file-viewer-light');
  });

  it('renders a README as a document with the mode toggle (dark)', async () => {
    await renderHost('viewer-dark', true);
    await expect.element(page.getByTestId('viewer-dark')).toMatchScreenshot('file-viewer-dark');
  });
});
