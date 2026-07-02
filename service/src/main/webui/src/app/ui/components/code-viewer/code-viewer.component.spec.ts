import { TestBed } from '@angular/core/testing';

import { CodeViewerComponent } from './code-viewer.component';

describe('CodeViewerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodeViewerComponent],
    }).compileComponents();
  });

  function createComponent(inputs: {
    path: string;
    content: string | null;
    binary?: boolean;
  }) {
    const fixture = TestBed.createComponent(CodeViewerComponent);
    fixture.componentRef.setInput('path', inputs.path);
    fixture.componentRef.setInput('content', inputs.content);
    fixture.componentRef.setInput('binary', inputs.binary ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('shows a placeholder for a binary file and mounts no editor', () => {
    const fixture = createComponent({ path: 'blob.bin', content: null, binary: true });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('Binary file');
    expect(fixture.nativeElement.querySelector('.cm-editor')).toBeNull();
  });

  it('shows a placeholder when there is no content', () => {
    const fixture = createComponent({ path: 'empty.txt', content: null });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('No content');
    expect(fixture.nativeElement.querySelector('.cm-editor')).toBeNull();
  });
});
