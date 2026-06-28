import { TestBed } from '@angular/core/testing';

import { BranchTreeComponent, BranchTreeNode } from './branch-tree.component';

function tree(behind: number, ahead: number, conflictsWithParent = false): BranchTreeNode[] {
  return [
    {
      key: 'master',
      label: 'master',
      data: null,
      children: [
        {
          key: 'feature/x',
          label: 'feature/x',
          data: {
            worktreeId: 'x',
            branch: 'feature/x',
            parent: 'master',
            ahead,
            behind,
            conflictsWithParent,
          },
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

  it('shows the behind number as a fast-forward action when behind but not ahead', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    // behind 2, ahead 0 → a clean fast-forward is possible, so the behind count renders as a
    // clickable action rather than the diverged alert icon.
    fixture.componentRef.setInput('nodes', tree(2, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const connector = (fixture.nativeElement as HTMLElement).querySelector('[title]')!;
    expect(connector.textContent).toContain('+0');
    // behind renders as a negative number on the fast-forward button
    expect(connector.textContent).toContain('-2');
    const behindButton = Array.from(connector.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('-2'),
    )!;
    expect(behindButton).toBeTruthy();
    expect(behindButton.classList.contains('invisible')).toBe(false);
  });

  it('shows a conflict alert instead of the behind number when diverged and merge would conflict', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    // behind 2, ahead 5, conflicts → integration needs manual resolution, so an alert replaces the
    // count.
    fixture.componentRef.setInput('nodes', tree(2, 5, true));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const connector = (fixture.nativeElement as HTMLElement).querySelector('[title]')!;
    expect(connector.textContent).toContain('+5');
    expect(connector.textContent).not.toContain('-2');
    expect(connector.querySelector('ng-icon')).toBeTruthy();
  });

  it('offers an update (merge parent in) action when diverged but the merge is clean', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    // behind 2, ahead 5, no conflict → a fast-forward can't apply, but merging the parent in can,
    // so the behind count is a clickable update action (not the conflict icon).
    fixture.componentRef.setInput('nodes', tree(2, 5, false));
    let updated: { worktreeId?: string } | undefined;
    fixture.componentInstance.update.subscribe((w) => (updated = w));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const connector = (fixture.nativeElement as HTMLElement).querySelector('[title]')!;
    expect(connector.textContent).toContain('+5');
    expect(connector.querySelector('ng-icon')).toBeFalsy();
    const updateButton = Array.from(connector.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('-2'),
    )!;
    expect(updateButton).toBeTruthy();
    updateButton.click();
    expect(updated?.worktreeId).toBe('x');
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
    buttons
      .find((b) => b.textContent?.includes('Branch off worktree') && b.closest('[title]') === null)
      ?.click();
    // a branch-off button exists for every card; just assert the event carries a branch name
    buttons.find((b) => b.textContent?.includes('Branch off worktree'))!.click();
    expect(typeof branchedOff).toBe('string');
  });
});
