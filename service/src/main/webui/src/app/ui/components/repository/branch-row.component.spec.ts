import { TestBed } from '@angular/core/testing';

import { BranchRowComponent } from './branch-row.component';

describe('BranchRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BranchRowComponent],
    }).compileComponents();
  });

  it('offers to branch off a branch that has no worktree, without an inline Integrate', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'develop');
    fixture.componentRef.setInput('worktree', null);
    fixture.detectChanges();

    let branchedOff = false;
    fixture.componentInstance.branchOff.subscribe(() => (branchedOff = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('develop');
    const buttons = Array.from(el.querySelectorAll('button'));
    // Integrate moved into the commit popover (Forward tab) — not on the row anymore.
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

  it('shows the worktree and emits branch off/abandon when one is present', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
    });
    fixture.detectChanges();

    let branchedOff = false;
    let abandoned = false;
    fixture.componentInstance.branchOff.subscribe(() => (branchedOff = true));
    fixture.componentInstance.abandon.subscribe(() => (abandoned = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('login-fix');
    expect(el.textContent).toContain('develop');
    const buttons = Array.from(el.querySelectorAll('button'));
    // Worktree-backed branches use Abandon, not Delete; Integrate lives in the commit popover.
    expect(buttons.some((b) => b.textContent?.includes('Delete'))).toBe(false);
    expect(buttons.some((b) => b.textContent?.includes('Integrate'))).toBe(false);
    buttons.find((b) => b.textContent?.includes('Branch off worktree'))!.click();
    buttons.find((b) => b.textContent?.includes('Abandon'))!.click();
    expect(branchedOff).toBe(true);
    expect(abandoned).toBe(true);
  });

  it('offers to open the worktree only for worktree-backed branches', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
    });
    fixture.detectChanges();

    let opened = false;
    fixture.componentInstance.openWorktree.subscribe(() => (opened = true));

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Work on it'))!.click();
    expect(opened).toBe(true);

    // A plain branch (no worktree) has nothing to work in.
    fixture.componentRef.setInput('worktree', null);
    fixture.detectChanges();
    const plainButtons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(plainButtons.some((b) => b.textContent?.includes('Work on it'))).toBe(false);
  });

  it('shows a STOPPED container and recreates it on Start', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
      runtimeStatus: 'STOPPED',
    });
    fixture.detectChanges();

    let started = false;
    fixture.componentInstance.ensureContainer.subscribe(() => (started = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('z-badge')?.textContent).toContain('STOPPED');
    const buttons = Array.from(el.querySelectorAll('button'));
    // A stopped container offers Start (recreate), not Stop.
    expect(buttons.some((b) => b.textContent?.trim() === 'Stop')).toBe(false);
    buttons.find((b) => b.textContent?.includes('Start'))!.click();
    expect(started).toBe(true);
  });

  it('shows a RUNNING container and stops it on Stop', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
      runtimeStatus: 'RUNNING',
    });
    fixture.detectChanges();

    let stopped = false;
    fixture.componentInstance.stopContainer.subscribe(() => (stopped = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('z-badge')?.textContent).toContain('RUNNING');
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Start'))).toBe(false);
    buttons.find((b) => b.textContent?.trim() === 'Stop')!.click();
    expect(stopped).toBe(true);
  });

  it('labels the control Recreate and shows the reason when provisioning FAILED', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/login');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'login-fix',
      branch: 'feature/login',
      parent: 'develop',
      runtimeStatus: 'FAILED',
      runtimeError: 'git-host unreachable',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('z-badge')?.getAttribute('title')).toContain('git-host unreachable');
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Recreate'))).toBe(true);
  });

  it('replaces integrate/abandon with cleanup when the worktree can be cleaned up', () => {
    const fixture = TestBed.createComponent(BranchRowComponent);
    fixture.componentRef.setInput('branch', 'feature/done');
    fixture.componentRef.setInput('worktree', {
      worktreeId: 'done',
      branch: 'feature/done',
      parent: 'master',
      ahead: 0,
      behind: 1,
    });
    fixture.componentRef.setInput('canCleanup', true);
    fixture.detectChanges();

    let cleaned = false;
    fixture.componentInstance.cleanup.subscribe(() => (cleaned = true));

    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll('button'));
    expect(buttons.some((b) => b.textContent?.includes('Integrate'))).toBe(false);
    expect(buttons.some((b) => b.textContent?.includes('Abandon'))).toBe(false);
    buttons.find((b) => b.textContent?.includes('Cleanup'))!.click();
    expect(cleaned).toBe(true);
  });
});
