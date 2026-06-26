import { TestBed } from '@angular/core/testing';

import { CommitRowComponent } from './commit-row.component';

describe('CommitRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommitRowComponent],
    }).compileComponents();
  });

  it('shows the message, author and short hash', () => {
    const fixture = TestBed.createComponent(CommitRowComponent);
    fixture.componentRef.setInput('commit', {
      hash: '140998cabc',
      shortHash: '140998c',
      author: 'Jane Dev',
      email: 'jane@example.com',
      date: '2024-01-02T03:04:05+00:00',
      message: 'Add feature.txt',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Add feature.txt');
    expect(el.textContent).toContain('Jane Dev');
    expect(el.textContent).toContain('140998c');
  });
});
