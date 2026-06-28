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

    // The count itself is the popover-trigger button, showing both -behind and +ahead.
    const el = fixture.nativeElement as HTMLElement;
    const countButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('-2'),
    )!;
    expect(countButton).toBeTruthy();
    expect(countButton.textContent).toContain('+0');
    expect(countButton.classList.contains('invisible')).toBe(false);
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

  it('opens the popover when the behind count is clicked instead of running the action directly', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    // behind 2, ahead 5, no conflict → behind, not a conflict, so the count is a popover trigger.
    fixture.componentRef.setInput('nodes', tree(2, 5, false));
    let updated: { worktreeId?: string } | undefined;
    fixture.componentInstance.update.subscribe((w) => (updated = w));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const countButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('-2'),
    )!;
    expect(countButton).toBeTruthy();
    expect(countButton.textContent).toContain('+5');
    expect(countButton.querySelector('ng-icon')).toBeFalsy();

    // Clicking the count opens the popover; it must NOT run the integration action anymore.
    countButton.click();
    expect(fixture.componentInstance.openWorktreeId()).toBe('x');
    expect(updated).toBeUndefined();
  });

  it('runs the footer action: merge for a diverged branch, fast-forward when only behind', () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    const component = fixture.componentInstance;

    let updated: { worktreeId?: string } | undefined;
    let fastForwarded: { worktreeId?: string } | undefined;
    component.update.subscribe((w) => (updated = w));
    component.fastForward.subscribe((w) => (fastForwarded = w));

    // Diverged (ahead + behind) → the footer offers a merge.
    const diverged = { worktreeId: 'd', branch: 'd', parent: 'master', behind: 2, ahead: 5 };
    expect(component.actionLabel(diverged)).toContain('Merge');
    component.runAction(diverged);
    expect(updated?.worktreeId).toBe('d');
    expect(fastForwarded).toBeUndefined();

    // Only behind → the footer offers a fast-forward.
    const behindOnly = { worktreeId: 'b', branch: 'b', parent: 'master', behind: 2, ahead: 0 };
    expect(component.actionLabel(behindOnly)).toContain('Fast-forward');
    component.runAction(behindOnly);
    expect(fastForwarded?.worktreeId).toBe('b');

    // Running the action closes the popover.
    expect(component.openWorktreeId()).toBeNull();
  });

  it('emits peek only when a behind-count popover opens, and exposes incoming commits per worktree', async () => {
    const fixture = TestBed.createComponent(BranchTreeComponent);
    fixture.componentRef.setInput('nodes', tree(2, 0));
    fixture.detectChanges();
    await fixture.whenStable();

    const peeked: string[] = [];
    fixture.componentInstance.peek.subscribe((w) => peeked.push(w.worktreeId!));

    // zVisibleChange(true) when the popover opens → peek; false (close) is ignored.
    const wt = { worktreeId: 'x', branch: 'feature/x', parent: 'master', behind: 2, ahead: 0 };
    fixture.componentInstance.onPeek(wt, false);
    fixture.componentInstance.onPeek(wt, true);
    expect(peeked).toEqual(['x']);

    // incomingFor/outgoingFor return commits only for the matching worktree (null = still loading).
    expect(fixture.componentInstance.incomingFor(wt)).toBeNull();
    expect(fixture.componentInstance.outgoingFor(wt)).toBeNull();
    fixture.componentRef.setInput('commitsPreview', {
      worktreeId: 'x',
      incoming: [
        { hash: 'h1', shortHash: 'h1', message: 'incoming', author: 'a', date: '', email: '' },
      ],
      outgoing: [
        { hash: 'o1', shortHash: 'o1', message: 'outgoing', author: 'a', date: '', email: '' },
        { hash: 'o2', shortHash: 'o2', message: 'outgoing 2', author: 'a', date: '', email: '' },
      ],
    });
    expect(fixture.componentInstance.incomingFor(wt)?.length).toBe(1);
    expect(fixture.componentInstance.outgoingFor(wt)?.length).toBe(2);
    expect(fixture.componentInstance.incomingFor({ ...wt, worktreeId: 'other' })).toBeNull();
    expect(fixture.componentInstance.outgoingFor({ ...wt, worktreeId: 'other' })).toBeNull();
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
