import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { page } from 'vitest/browser';

import { WorkspaceDto } from '@/api/model/workspaceDto';
import { BranchTreeComponent, BranchTreeNode } from './branch-tree.component';

/**
 * Visual regression for the workspace tree (zard `z-tree` + our cards), run in a
 * real headless Chromium via Vitest browser mode (`ng run qits-ui:test-visual`).
 * Baseline PNGs live under `__screenshots__/`; the run fails on pixel drift, so
 * a human and the agent inspect identical graphics.
 */

function wt(branch: string, parent: string, ahead: number, behind: number): WorkspaceDto {
  return { workspaceId: branch.replace('feature/', ''), branch, parent, ahead, behind };
}

// master
// ├─ feature/a              (ahead 3, behind 1)
// │  ├─ feature/a-1         (ahead 2)
// │  │  └─ feature/a-1-x    (ahead 1, behind 4)  <- child of a child of a child
// │  └─ feature/a-2         (behind 2)
// ├─ feature/b              (behind 5)
// └─ feature/c              (ahead 8)
// develop
const NODES: BranchTreeNode[] = [
  {
    key: 'master',
    label: 'master',
    data: null,
    children: [
      {
        key: 'feature/a',
        label: 'feature/a',
        data: wt('feature/a', 'master', 3, 1),
        children: [
          {
            key: 'feature/a-1',
            label: 'feature/a-1',
            data: wt('feature/a-1', 'feature/a', 2, 0),
            children: [
              {
                key: 'feature/a-1-x',
                label: 'feature/a-1-x',
                data: wt('feature/a-1-x', 'feature/a-1', 1, 4),
                children: [],
              },
            ],
          },
          {
            key: 'feature/a-2',
            label: 'feature/a-2',
            data: wt('feature/a-2', 'feature/a', 0, 2),
            children: [],
          },
        ],
      },
      { key: 'feature/b', label: 'feature/b', data: wt('feature/b', 'master', 0, 5), children: [] },
      { key: 'feature/c', label: 'feature/c', data: wt('feature/c', 'master', 8, 0), children: [] },
    ],
  },
  { key: 'develop', label: 'develop', data: null, children: [] },
];

@Component({
  imports: [BranchTreeComponent],
  template: `
    <div data-testid="tree" class="bg-background p-6" style="width: 720px">
      <app-branch-tree [nodes]="nodes" [repoId]="'r1'" />
    </div>
  `,
})
class TreeHost {
  readonly nodes = NODES;
}

describe('BranchTreeComponent (visual)', () => {
  it('nests children of children with the zard tree and shows ahead/behind counts', async () => {
    const fixture = TestBed.createComponent(TreeHost);
    document.body.style.margin = '0';
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    await expect.element(page.getByTestId('tree')).toMatchScreenshot('workspace-tree');
  });
});
