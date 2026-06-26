import { TestBed } from '@angular/core/testing';

import { ZardDialogComponent } from './dialog.component';

describe('ZardDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ZardDialogComponent],
    }).compileComponents();
  });

  it('renders nothing when closed and the titled panel when open', () => {
    const fixture = TestBed.createComponent(ZardDialogComponent);
    fixture.componentRef.setInput('zTitle', 'My Dialog');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.textContent).toContain('My Dialog');
  });

  it('close() sets open to false', () => {
    const fixture = TestBed.createComponent(ZardDialogComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    fixture.componentInstance.close();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
