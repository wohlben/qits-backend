import { TestBed } from '@angular/core/testing';

import { DaemonTerminalComponent } from './daemon-terminal.component';

describe('DaemonTerminalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DaemonTerminalComponent],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(DaemonTerminalComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('worktreeId', 'wt-1');
    fixture.componentRef.setInput('daemonId', 'd-1');
    fixture.componentRef.setInput('name', 'dev server');
    fixture.detectChanges();
    return fixture;
  }

  it('renders a Terminal trigger button', () => {
    const fixture = createComponent();
    const button = fixture.nativeElement.querySelector('button');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('Terminal');
  });

  it('computes the daemon interactive-attach socket path from its inputs', () => {
    const fixture = createComponent();
    expect(fixture.componentInstance.socketPath()).toBe('api/terminal/daemons/repo-1/wt-1/d-1');
  });
});
