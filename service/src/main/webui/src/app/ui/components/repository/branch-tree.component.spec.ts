import { TestBed } from '@angular/core/testing';

import { BranchTreeComponent, BranchTreeNode } from './branch-tree.component';

function tree(behind: number, ahead: number): BranchTreeNode[] {
  return [
    {
      key: 'master',
      label: 'master',
      data: null,
      children: [
        {
          key: 'feature/x',
          label: 'feature/x',
          data: { worktreeId: 'x', branch: 'feature/x', parent: 'master', ahead, behind },
          children: [],
        },
      ],
    },
  ];
}

describe('BranchTreeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BranchTreeComponent] }).compileComponents();
  });

  it('shows ahead/behind on a nested node and keeps the behind number visible when behind', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    fixture.componentRef.setInput('nodes', tree(2, 5));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const connector = (fixture.nativeElement as HTMLElement).querySelector('[title]')!;
    expect(connector.textContent).toContain('+5');
    // behind renders as a negative number
    expect(connector.textContent).toContain('-2');
    const behindSpan = Array.from(connector.querySelectorAll('span')).find((s) => s.textContent?.includes('-2'))!;
    expect(behindSpan.classList.contains('invisible')).toBe(false);
  });

  it('hides the behind number when level with the parent but still shows +0 ahead', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    fixture.componentRef.setInput('nodes', tree(0, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const connector = (fixture.nativeElement as HTMLElement).querySelector('[title]')!;
    const spans = Array.from(connector.querySelectorAll('span'));
    const aheadSpan = spans.find((s) => s.classList.contains('font-semibold'))!;
    const behindSpan = spans.find((s) => s !== aheadSpan)!;
    expect(aheadSpan.textContent).toContain('+0');
    expect(behindSpan.classList.contains('invisible')).toBe(true);
  });

  it('bubbles the branch name when a card asks to branch off', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    fixture.componentRef.setInput('nodes', tree(0, 1));
    let branchedOff: string | undefined;
    fixture.componentInstance.branchOff.subscribe((b) => (branchedOff = b));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Branch off worktree') && b.closest('[title]') === null)?.click();
    // a branch-off button exists for every card; just assert the event carries a branch name
    buttons.find((b) => b.textContent?.includes('Branch off worktree'))!.click();
    expect(typeof branchedOff).toBe('string');
  });
});
