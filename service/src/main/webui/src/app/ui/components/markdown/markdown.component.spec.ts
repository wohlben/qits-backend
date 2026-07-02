import { TestBed } from '@angular/core/testing';

import { MarkdownComponent } from './markdown.component';

describe('MarkdownComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownComponent],
    }).compileComponents();
  });

  function render(text: string): HTMLElement {
    const fixture = TestBed.createComponent(MarkdownComponent);
    fixture.componentRef.setInput('text', text);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders inline markdown as HTML', () => {
    const el = render('Hello **bold** and `code`.');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('code')?.textContent).toBe('code');
  });

  it('renders block markdown: lists, headings and fenced code', () => {
    const el = render('# Title\n\n- one\n- two\n\n```\nconst x = 1;\n```');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelectorAll('li').length).toBe(2);
    expect(el.querySelector('pre code')?.textContent).toContain('const x = 1;');
  });

  it('strips unsafe HTML via Angular sanitization', () => {
    const el = render('<script>alert(1)</script>ok');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('ok');
  });
});
