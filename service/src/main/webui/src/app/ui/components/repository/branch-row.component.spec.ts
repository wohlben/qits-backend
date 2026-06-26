import { TestBed } from '@angular/core/testing';

import { BranchRowComponent } from './branch-row.component';

describe('BranchRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BranchRowComponent],
    }).compileComponents();
  });

  it('offers to branch off a worktree when the branch has none', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'develop');
    fixture.componentRef.setInput('worktree', null);
    fixture.detectChanges();

    let branchedOff = false;
    fixture.componentInstance.branchOff.subscribe(() => (branchedOff = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('develop');
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Integrate'))).toBe(false);
    buttons.find((b) => b.textContent?.includes('Branch off worktree'))!.click();
    expect(branchedOff).toBe(true);
  });

  it('offers to delete a childless branch with no worktree', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'stale');
    fixture.componentRef.setInput('worktree', null);
    fixture.componentRef.setInput('hasChildren', false);
    fixture.detectChanges();

    let deleted = false;
    fixture.componentInstance.delete.subscribe(() => (deleted = true));

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Delete'))!.click();
    expect(deleted).toBe(true);
  });

  it('hides delete when the branch has children', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'master');
    fixture.componentRef.setInput('worktree', null);
    fixture.componentRef.setInput('hasChildren', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Delete'))).toBe(false);
  });

  it('shows the worktree and emits branch off/integrate/abandon when one is present', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
    });
    fixture.detectChanges();

    let branchedOff = false;
    let integrated = false;
    let abandoned = false;
    fixture.componentInstance.branchOff.subscribe(() => (branchedOff = true));
    fixture.componentInstance.integrate.subscribe(() => (integrated = true));
    fixture.componentInstance.abandon.subscribe(() => (abandoned = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('login-fix');
    expect(el.textContent).toContain('develop');
    // A worktree can be branched off again so worktrees can nest into a tree.
    const buttons = Array.from(el.querySelectorAll('button'));
    // Worktree-backed branches use Abandon, not Delete.
    expect(buttons.some((b) => b.textContent?.includes('Delete'))).toBe(false);
    buttons.find((b) => b.textContent?.includes('Branch off worktree'))!.click();
    buttons.find((b) => b.textContent?.includes('Integrate'))!.click();
    buttons.find((b) => b.textContent?.includes('Abandon'))!.click();
    expect(branchedOff).toBe(true);
    expect(integrated).toBe(true);
    expect(abandoned).toBe(true);
  });
});
