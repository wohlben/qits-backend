import { type CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ZardTabComponent, ZardTabGroupComponent } from './tabs.component';

const STORAGE_KEY = 'qits.test.tab-order';

@Component({
  imports: [ZardTabComponent, ZardTabGroupComponent],
  template: `
    <z-tab-group [zReorderKey]="reorderKey">
      <z-tab label="Alpha"><p data-testid="alpha-body">alpha</p></z-tab>
      <z-tab label="Beta"><p data-testid="beta-body">beta</p></z-tab>
      <z-tab label="Gamma"><p data-testid="gamma-body">gamma</p></z-tab>
    </z-tab-group>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  reorderKey: string | null = STORAGE_KEY;
}

describe('ZardTabGroupComponent reordering', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
  });

  afterEach(() => {
    localStorage.clear();
  });

  function navLabels(el: HTMLElement): (string | undefined)[] {
    return Array.from(el.querySelectorAll('nav[role="tablist"] [role="tab"]')).map(b =>
      b.textContent?.trim(),
    );
  }

  function tabButton(el: HTMLElement, label: string): HTMLButtonElement {
    const button = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
      b => b.textContent?.trim() === label,
    );
    expect(button, `tab "${label}"`).toBeDefined();
    return button!;
  }

  function drop(fixture: ReturnType<typeof TestBed.createComponent>, previousIndex: number, currentIndex: number) {
    const dropList = fixture.debugElement.query(By.directive(CdkDropList)).injector.get(CdkDropList);
    dropList.dropped.emit({ previousIndex, currentIndex } as unknown as CdkDragDrop<unknown>);
    fixture.detectChanges();
  }

  it('renders content order and selects the first tab when nothing is persisted', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(navLabels(el)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(tabButton(el, 'Alpha').getAttribute('aria-selected')).toBe('true');
  });

  it('restores a persisted order — unknown labels dropped, unsaved tabs appended — and selects the first displayed tab', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['Gamma', 'Removed tab', 'Alpha']));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(navLabels(el)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(tabButton(el, 'Gamma').getAttribute('aria-selected')).toBe('true');
  });

  it('falls back to content order when the persisted value is unreadable', () => {
    localStorage.setItem(STORAGE_KEY, 'not json {');
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(navLabels(fixture.nativeElement as HTMLElement)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('a drop reorders the nav, keeps the active tab selected, and persists the labels', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    drop(fixture, 0, 2); // Alpha (active) to the end

    expect(navLabels(el)).toEqual(['Beta', 'Gamma', 'Alpha']);
    expect(tabButton(el, 'Alpha').getAttribute('aria-selected')).toBe('true');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['Beta', 'Gamma', 'Alpha']);
  });

  it('keeps tab buttons paired to their panels after a reorder (aria-controls follows the content)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    drop(fixture, 0, 2);

    const gammaButton = tabButton(el, 'Gamma');
    const gammaPanel = el.querySelector(`#${gammaButton.getAttribute('aria-controls')}`)!;
    expect(gammaPanel.querySelector('[data-testid="gamma-body"]')).not.toBeNull();

    gammaButton.click();
    fixture.detectChanges();
    expect((gammaPanel as HTMLElement).hidden).toBe(false);
    expect(gammaPanel.getAttribute('aria-labelledby')).toBe(gammaButton.id);
  });

  it('disables dragging when no zReorderKey is set', () => {
    const fixture = TestBed.createComponent(HostComponent);
    (fixture.componentInstance as HostComponent).reorderKey = null;
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('nav[role="tablist"]')!.classList).toContain('cdk-drop-list-disabled');
    expect(tabButton(el, 'Alpha').classList).toContain('cdk-drag-disabled');
  });
});
