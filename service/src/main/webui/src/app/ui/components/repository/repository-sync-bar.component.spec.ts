import { TestBed } from '@angular/core/testing';

import { RepositorySyncBarComponent } from './repository-sync-bar.component';

describe('RepositorySyncBarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RepositorySyncBarComponent],
    }).compileComponents();
  });

  it('shows ahead/behind counts and emits sync actions', () => {
    const fixture = TestBed.createComponent(RepositorySyncBarComponent);
    fixture.componentRef.setInput('branch', 'main');
    fixture.componentRef.setInput('branches', ['main', 'feature']);
    fixture.componentRef.setInput('status', {
      branch: 'main',
      remoteReachable: true,
      remoteExists: true,
      ahead: 2,
      behind: 1,
    });
    fixture.detectChanges();

    let pulled = false;
    let synced = false;
    let pushed = false;
    fixture.componentInstance.pull.subscribe(() => (pulled = true));
    fixture.componentInstance.sync.subscribe(() => (synced = true));
    fixture.componentInstance.push.subscribe(() => (pushed = true));

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('↑2');
    expect(el.textContent).toContain('↓1');

    const buttons = Array.from(el.querySelectorAll('button'));
    buttons.find((b) => b.textContent?.includes('Pull'))!.click();
    buttons.find((b) => b.textContent?.includes('Sync'))!.click();
    buttons.find((b) => b.textContent?.includes('Push'))!.click();
    expect(pulled).toBe(true);
    expect(synced).toBe(true);
    expect(pushed).toBe(true);
  });

  it('reports an up-to-date repository', () => {
    const fixture = TestBed.createComponent(RepositorySyncBarComponent);
    fixture.componentRef.setInput('status', {
      branch: 'main',
      remoteReachable: true,
      remoteExists: true,
      ahead: 0,
      behind: 0,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Up to date');
  });

  it('flags an unreachable remote', () => {
    const fixture = TestBed.createComponent(RepositorySyncBarComponent);
    fixture.componentRef.setInput('status', {
      branch: 'main',
      remoteReachable: false,
      remoteExists: false,
      ahead: null,
      behind: null,
    });
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('unreachable');
  });

  it('disables controls and emits the chosen main branch', () => {
    const fixture = TestBed.createComponent(RepositorySyncBarComponent);
    fixture.componentRef.setInput('branch', 'main');
    fixture.componentRef.setInput('branches', ['main', 'feature']);
    fixture.componentRef.setInput('pullPending', true);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const pushButton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Push'),
    )!;
    // A pull in flight blocks the other actions.
    expect(pushButton.disabled).toBe(true);

    let chosen: string | undefined;
    fixture.componentInstance.mainBranchChange.subscribe((b) => (chosen = b));
    fixture.componentInstance.onSelect('feature');
    expect(chosen).toBe('feature');

    // Selecting the already-current branch emits nothing.
    chosen = undefined;
    fixture.componentInstance.onSelect('main');
    expect(chosen).toBeUndefined();
  });
});
