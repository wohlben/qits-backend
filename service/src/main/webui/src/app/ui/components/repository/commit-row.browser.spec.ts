import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { CommitDto } from '@/api/model/commitDto';
import { CommitRowComponent } from './commit-row.component';

/**
 * Visual regression for the branch commit log (the `app-commit-row` cards laid out exactly
 * as `CommitListComponent` stacks them). Runs in a real headless Chromium via Vitest browser
 * mode (`ng run qits-ui:test-visual`). Baseline PNGs live under `__screenshots__/`; the run
 * fails on pixel drift, so a human and the agent inspect identical graphics.
 */

function commit(shortHash: string, message: string, author: string, date: string): CommitDto {
  return { hash: shortHash + '0000', shortHash, message, author, email: `${author}@example.com`, date };
}

// A typical branch log: newest first, the commits unique to the branch.
const COMMITS: CommitDto[] = [
  commit('a1b2c3d', 'Add commit log view for branches', 'Jane Dev', '2024-03-12T14:05:00+00:00'),
  commit('9f8e7d6', 'Wire View commits button into the branch tree', 'Sam Maintainer', '2024-03-12T11:42:00+00:00'),
  commit('1234abc', 'Expose /repositories/{id}/commits endpoint', 'Jane Dev', '2024-03-11T09:18:00+00:00'),
];

@Component({
  imports: [CommitRowComponent],
  template: `
    <div data-testid="commit-list" class="bg-background p-6" style="width: 720px">
      <div class="flex flex-col gap-2">
        @for (c of commits; track c.hash) {
          <app-commit-row [commit]="c" />
        }
      </div>
    </div>
  `,
})
class CommitListHost {
  readonly commits = COMMITS;
}

describe('CommitRowComponent (visual)', () => {
  it('renders a branch commit log with message, author/date and short hash', async () => {
    const fixture = TestBed.createComponent(CommitListHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('commit-list')).toMatchScreenshot('commit-list');
  });
});
