import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { EpicFormComponent, EpicFormData } from './epic-form.component';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('EpicFormComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EpicFormComponent],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(EpicFormComponent);
    fixture.detectChanges();
    return fixture;
  }

  function submitForm(fixture: ReturnType<typeof createComponent>) {
    (fixture.nativeElement as HTMLElement)
      .querySelector('form')!
      .dispatchEvent(new Event('submit'));
  }

  it('does not emit when the required title is missing', async () => {
    const fixture = createComponent();
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);

    submitForm(fixture);
    await flush();

    expect(submitted).not.toHaveBeenCalled();
  });

  it('emits the model once the title is set', async () => {
    const fixture = createComponent();
    const submitted = vi.fn();
    fixture.componentInstance.submitted.subscribe(submitted);
    fixture.componentInstance.model.set({ title: 'Observability', description: '# Spine' });

    submitForm(fixture);
    await flush();

    expect(submitted).toHaveBeenCalledWith({
      title: 'Observability',
      description: '# Spine',
    } satisfies EpicFormData);
  });

  it('seeds the model from initialData', () => {
    const fixture = TestBed.createComponent(EpicFormComponent);
    fixture.componentRef.setInput('initialData', { title: 'Seeded', description: 'Body' });
    fixture.detectChanges();

    expect(fixture.componentInstance.model()).toEqual({ title: 'Seeded', description: 'Body' });
    const titleInput = (fixture.nativeElement as HTMLElement).querySelector(
      'input[id="epic-title"]',
    ) as HTMLInputElement;
    expect(titleInput.value).toBe('Seeded');
  });
});
