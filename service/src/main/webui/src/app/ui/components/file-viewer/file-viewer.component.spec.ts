import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { CodeViewerComponent } from '@/ui/components/code-viewer/code-viewer.component';
import { FileViewerComponent, type FileViewMode } from './file-viewer.component';
import { MarkdownFileRendererComponent } from './markdown-file-renderer.component';

describe('FileViewerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileViewerComponent],
    }).compileComponents();
  });

  function createComponent(inputs: {
    path: string;
    content: string | null;
    binary?: boolean;
    mode?: FileViewMode;
  }): ComponentFixture<FileViewerComponent> {
    const fixture = TestBed.createComponent(FileViewerComponent);
    fixture.componentRef.setInput('path', inputs.path);
    fixture.componentRef.setInput('content', inputs.content);
    fixture.componentRef.setInput('binary', inputs.binary ?? false);
    if (inputs.mode) {
      fixture.componentRef.setInput('mode', inputs.mode);
    }
    fixture.detectChanges();
    return fixture;
  }

  function toggleButtons(fixture: ComponentFixture<FileViewerComponent>): HTMLButtonElement[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].filter((b) =>
      ['Preview', 'Code'].includes(b.textContent?.trim() ?? ''),
    );
  }

  it('renders markdown with a mode toggle by default, without mounting the source view', () => {
    const fixture = createComponent({ path: 'README.md', content: '# Title\n' });

    expect(fixture.debugElement.query(By.directive(MarkdownFileRendererComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(CodeViewerComponent))).toBeNull();
    expect(toggleButtons(fixture)).toHaveLength(2);
  });

  it('shows the source view in source mode and re-emits its line-range selections', () => {
    const fixture = createComponent({ path: 'README.md', content: '# Title\n', mode: 'source' });
    const ranges: unknown[] = [];
    fixture.componentInstance.selectRange.subscribe((r) => ranges.push(r));

    const codeViewer = fixture.debugElement.query(By.directive(CodeViewerComponent));
    expect(codeViewer).not.toBeNull();
    expect(toggleButtons(fixture)).toHaveLength(2);

    (codeViewer.componentInstance as CodeViewerComponent).selectRange.emit({
      startLine: 2,
      endLine: 5,
    });
    expect(ranges).toEqual([{ startLine: 2, endLine: 5 }]);
  });

  it('shows files without a renderer as source only, with no toggle', () => {
    const fixture = createComponent({ path: 'main.ts', content: 'const x = 1;\n' });

    expect(fixture.debugElement.query(By.directive(CodeViewerComponent))).not.toBeNull();
    expect(fixture.debugElement.query(By.directive(MarkdownFileRendererComponent))).toBeNull();
    expect(toggleButtons(fixture)).toHaveLength(0);
  });

  it('keeps the binary placeholder for a binary markdown file, with no toggle', () => {
    const fixture = createComponent({ path: 'weird.md', content: null, binary: true });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Binary file');
    expect(toggleButtons(fixture)).toHaveLength(0);
  });

  it('emits modeChange on toggle clicks without flipping the view itself', () => {
    const fixture = createComponent({ path: 'README.md', content: '# Title\n' });
    const modes: FileViewMode[] = [];
    fixture.componentInstance.modeChange.subscribe((m) => modes.push(m));

    const codeButton = toggleButtons(fixture).find((b) => b.textContent?.includes('Code'))!;
    codeButton.click();
    fixture.detectChanges();

    expect(modes).toEqual(['source']);
    // controlled component: the parent owns the mode, so the rendered view stays until it does
    expect(fixture.debugElement.query(By.directive(MarkdownFileRendererComponent))).not.toBeNull();
  });

  it('re-emits the renderer’s resolved links as openPath', () => {
    const fixture = createComponent({ path: 'docs/intro.md', content: '[x](./other.md)\n' });
    const paths: string[] = [];
    fixture.componentInstance.openPath.subscribe((p) => paths.push(p));

    const renderer = fixture.debugElement.query(By.directive(MarkdownFileRendererComponent))
      .componentInstance as MarkdownFileRendererComponent;
    renderer.openLink.emit('docs/other.md');

    expect(paths).toEqual(['docs/other.md']);
  });
});
