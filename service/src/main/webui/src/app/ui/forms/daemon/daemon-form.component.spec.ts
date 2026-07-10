import { TestBed } from '@angular/core/testing';

import { DaemonFormComponent, DaemonFormData } from './daemon-form.component';

describe('DaemonFormComponent — health check editor', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DaemonFormComponent],
    }).compileComponents();
  });

  function createComponent() {
    const fixture = TestBed.createComponent(DaemonFormComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('adds and removes health check rows', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;

    component.addHealthCheck();
    fixture.detectChanges();
    expect(component.model().healthChecks).toHaveLength(1);
    expect(component.model().healthChecks[0].kind).toBe('HTTP');

    component.removeHealthCheck(0);
    fixture.detectChanges();
    expect(component.model().healthChecks).toHaveLength(0);
  });

  it('switches the kind-dependent fields: HTTP shows port/path, COMMAND shows the script', () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    component.addHealthCheck();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    // HTTP: port + path + expectStatus inputs, no command textarea.
    expect(element.querySelector('[aria-label="Health check 1 port"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Health check 1 path"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Health check 1 command"]')).toBeNull();

    component.updateHealthCheck(0, 'kind', 'COMMAND');
    fixture.detectChanges();
    expect(element.querySelector('[aria-label="Health check 1 port"]')).toBeNull();
    expect(element.querySelector('[aria-label="Health check 1 command"]')).not.toBeNull();

    component.updateHealthCheck(0, 'kind', 'TCP');
    fixture.detectChanges();
    expect(element.querySelector('[aria-label="Health check 1 port"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Health check 1 path"]')).toBeNull();
  });

  it('submits the edited health check rows with the rest of the form', async () => {
    const fixture = createComponent();
    const component = fixture.componentInstance;
    let submitted: DaemonFormData | undefined;
    component.submitted.subscribe((data) => (submitted = data));

    component.model.update((m) => ({ ...m, name: 'dev', startScript: 'npm run dev' }));
    component.addHealthCheck();
    component.updateHealthCheck(0, 'name', 'Angular');
    component.updateHealthCheck(0, 'port', '4200');
    component.updateHealthCheck(0, 'expectStatus', '2xx,3xx,4xx');
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(submitted).toBeDefined();
    expect(submitted!.healthChecks).toEqual([
      expect.objectContaining({
        name: 'Angular',
        kind: 'HTTP',
        port: '4200',
        expectStatus: '2xx,3xx,4xx',
      }),
    ]);
  });
});
