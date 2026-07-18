import { CdkDrag, type CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  DOCUMENT,
  effect,
  type ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  runInInjectionContext,
  signal,
  type TemplateRef,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronLeft, lucideChevronRight, lucideChevronUp } from '@ng-icons/lucide';
import clsx from 'clsx';
import { debounceTime, fromEvent, merge, map, distinctUntilChanged } from 'rxjs';
import { twMerge } from 'tailwind-merge';

import { ZardButtonComponent } from '@/shared/components/button';
import {
  tabButtonVariants,
  tabContainerVariants,
  tabNavVariants,
  type ZardTabVariants,
} from '@/shared/components/tabs/tabs.variants';

export type zPosition = 'top' | 'bottom' | 'left' | 'right';
export type zAlign = 'center' | 'start' | 'end';
export type ZardTabIndicator = 'primary' | 'success' | 'warning';

@Component({
  selector: 'z-tab',
  imports: [],
  template: `
    <ng-template #content>
      <ng-content />
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class ZardTabComponent {
  readonly label = input.required<string>();
  /**
   * Optional status dot on the tab's nav button, with `indicatorLabel` as its tooltip. This is a
   * deliberate local qits extension to the zard tabs component (not upstream) — preserve it when
   * regenerating the component via the zard CLI.
   */
  readonly indicator = input<ZardTabIndicator | null>(null);
  readonly indicatorLabel = input('');
  /**
   * Pins this tab to the front of the displayed row, ahead of any persisted reorder — for
   * transient tabs (e.g. the workspace-start process view) that must lead while they exist and
   * whose label deliberately never enters the saved order. Like `indicator`, a deliberate local
   * qits extension to the zard tabs component (not upstream) — preserve it when regenerating via
   * the zard CLI.
   */
  readonly zPinFirst = input(false);
  readonly contentTemplate = viewChild.required<TemplateRef<unknown>>('content');
}

@Component({
  selector: 'z-tab-group',
  imports: [CdkDrag, CdkDropList, NgTemplateOutlet, ZardButtonComponent, NgIcon],
  template: `
    @if (navBeforeContent()) {
      <ng-container [ngTemplateOutlet]="navigationBlock" />
    }

    <!--
      Panels stay in content order even when the nav is reordered: moving a panel's DOM node
      would reload iframes and reset scroll state in keep-mounted tabs. Only the nav buttons
      move; tab/tabpanel pairing goes through the stable content index.
    -->
    <div class="flex-1">
      @for (tab of tabs(); track tab; let index = $index) {
        <div
          role="tabpanel"
          [attr.id]="'tabpanel-' + uid + '-' + index"
          [attr.aria-labelledby]="'tab-' + uid + '-' + index"
          [attr.tabindex]="0"
          [hidden]="activeTab() !== tab"
          class="focus-visible:ring-primary/50 outline-none focus-visible:ring-2"
        >
          <ng-container [ngTemplateOutlet]="tab.contentTemplate()" />
        </div>
      }
    </div>

    @if (!navBeforeContent()) {
      <ng-container [ngTemplateOutlet]="navigationBlock" />
    }

    <ng-template #navigationBlock>
      @let horizontal = isHorizontal();

      <div [class]="navGridClasses()">
        @if (showArrow()) {
          @if (horizontal) {
            <button
              type="button"
              [class]="'cursor-pointer pr-4 ' + (zTabsPosition() === 'top' ? 'mb-4' : 'mt-4')"
              (click)="scrollNav('left')"
            >
              <ng-icon name="lucideChevronLeft" />
            </button>
          } @else {
            <button
              type="button"
              [class]="'cursor-pointer pb-4 ' + (zTabsPosition() === 'left' ? 'mr-4' : 'ml-4')"
              (click)="scrollNav('up')"
            >
              <ng-icon name="lucideChevronUp" />
            </button>
          }
        }

        <nav
          [class]="navClasses()"
          #tabNav
          role="tablist"
          cdkDropList
          [cdkDropListDisabled]="!reorderable()"
          [cdkDropListOrientation]="horizontal ? 'horizontal' : 'vertical'"
          (cdkDropListDropped)="onTabDrop($event)"
          [attr.aria-orientation]="horizontal ? 'horizontal' : 'vertical'"
        >
          @for (entry of navTabs(); track entry.tab) {
            <button
              type="button"
              z-button
              zType="ghost"
              role="tab"
              cdkDrag
              [cdkDragDisabled]="!reorderable()"
              [attr.id]="'tab-' + uid + '-' + entry.contentIndex"
              [attr.aria-selected]="activeTab() === entry.tab"
              [attr.tabindex]="activeTab() === entry.tab ? 0 : -1"
              [attr.aria-controls]="'tabpanel-' + uid + '-' + entry.contentIndex"
              (click)="setActiveTab(entry.tab)"
              [class]="buttonClassesSignal().get(entry.tab)"
            >
              {{ entry.tab.label() }}
              @if (entry.tab.indicator(); as indicator) {
                <span
                  class="ml-1.5 inline-block size-2 rounded-full"
                  [class]="indicatorClasses[indicator]"
                  [attr.title]="entry.tab.indicatorLabel() || null"
                ></span>
              }
            </button>
          }
        </nav>

        @if (showArrow()) {
          @if (horizontal) {
            <button
              type="button"
              [class]="'cursor-pointer pl-4 ' + (zTabsPosition() === 'top' ? 'mb-4' : 'mt-4')"
              (click)="scrollNav('right')"
            >
              <ng-icon name="lucideChevronRight" />
            </button>
          } @else {
            <button
              type="button"
              [class]="'cursor-pointer pt-4 ' + (zTabsPosition() === 'left' ? 'mr-4' : 'ml-4')"
              (click)="scrollNav('down')"
            >
              <ng-icon name="lucideChevronDown" />
            </button>
          }
        }
      </div>
    </ng-template>
  `,
  styles: `
    .nav-tab-scroll {
      -webkit-overflow-scrolling: touch;
      scroll-behavior: smooth;
      &::-webkit-scrollbar-thumb {
        background-color: rgba(209, 209, 209, 0.2);
        border-radius: 2px;
      }
      &::-webkit-scrollbar {
        height: 4px;
        width: 4px;
      }
      &::-webkit-scrollbar-button {
        display: none;
      }
    }
    nav[role='tablist'] .cdk-drag-placeholder {
      opacity: 0.4;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  viewProviders: [
    provideIcons({
      lucideChevronLeft,
      lucideChevronUp,
      lucideChevronRight,
      lucideChevronDown,
    }),
  ],
  host: { '[class]': 'containerClasses()' },
})
export class ZardTabGroupComponent implements AfterViewInit {
  private readonly tabComponents = contentChildren(ZardTabComponent, { descendants: true });
  private readonly tabsContainer = viewChild.required<ElementRef>('tabNav');
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;

  protected readonly tabs = computed(() => this.tabComponents());
  protected readonly activeTab = signal<ZardTabComponent | null>(null);
  protected readonly scrollPresent = signal<boolean>(false);

  private static instanceCounter = 0;
  /**
   * Per-instance discriminator for the `tab-*`/`tabpanel-*` DOM ids, so nested or repeated tab
   * groups on one page don't mint duplicate ids (an ARIA violation — `aria-controls` would become
   * ambiguous). Like `indicator`, a deliberate local qits extension to the zard tabs component
   * (not upstream) — preserve it when regenerating via the zard CLI.
   */
  protected readonly uid = ZardTabGroupComponent.instanceCounter++;

  readonly zTabChange = output<{
    index: number;
    label: string;
    tab: ZardTabComponent;
  }>();

  protected readonly zDeselect = output<{
    index: number;
    label: string;
    tab: ZardTabComponent;
  }>();

  readonly zTabsPosition = input<ZardTabVariants['zPosition']>('top');
  readonly zActivePosition = input<ZardTabVariants['zActivePosition']>('bottom');
  readonly zShowArrow = input(true);
  readonly zScrollAmount = input(100);
  readonly zAlignTabs = input<zAlign>('start');
  // Preserve consumer classes on host
  readonly class = input<string>('');

  /**
   * Opt-in drag-to-reorder of the nav buttons, persisted in localStorage under this key. Like
   * `indicator`, a deliberate local qits extension to the zard tabs component (not upstream) —
   * preserve it when regenerating via the zard CLI. The saved order is a label array, so only use
   * this on groups whose labels are stable; panels keep their content order (see the template
   * note), only the nav rearranges.
   */
  readonly zReorderKey = input<string | null>(null);

  protected readonly reorderable = computed(() => this.zReorderKey() !== null);

  /** The order persisted under `zReorderKey`, or null when unset, absent, or unreadable. */
  private readonly storedOrder = computed<string[] | null>(() => {
    const key = this.zReorderKey();
    if (!key || !this.window) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(this.window.localStorage.getItem(key) ?? 'null');
      return Array.isArray(parsed) && parsed.every(label => typeof label === 'string') ? parsed : null;
    } catch {
      return null;
    }
  });

  private readonly order = linkedSignal(() => this.storedOrder());

  /**
   * Tabs in display order: pinned tabs lead (in content order, exempt from the saved order), then
   * saved labels (unknown ones dropped), then unsaved tabs appended.
   */
  protected readonly orderedTabs = computed(() => {
    const pinned = this.tabs().filter(tab => tab.zPinFirst());
    const tabs = this.tabs().filter(tab => !tab.zPinFirst());
    const order = this.order();
    if (!order) {
      return [...pinned, ...tabs];
    }
    const byLabel = new Map(tabs.map(tab => [tab.label(), tab]));
    const ordered = order.map(label => byLabel.get(label)).filter((tab): tab is ZardTabComponent => !!tab);
    const seen = new Set(ordered);
    return [...pinned, ...ordered, ...tabs.filter(tab => !seen.has(tab))];
  });

  /** Display-ordered tabs paired with their content index, which pairs `tab-N` to `tabpanel-N`. */
  protected readonly navTabs = computed(() => {
    const tabs = this.tabs();
    return this.orderedTabs().map(tab => ({ tab, contentIndex: tabs.indexOf(tab) }));
  });

  protected readonly showArrow = computed(() => this.zShowArrow() && this.scrollPresent());

  /** Dot colors for the local `indicator` extension; keys match {@link ZardTabIndicator}. */
  protected readonly indicatorClasses: Record<ZardTabIndicator, string> = {
    primary: 'bg-primary',
    success: 'bg-green-500',
    warning: 'bg-amber-500',
  };

  /** Pinned tabs already seen, so only a genuinely new pinned tab steals the selection. */
  private seenPinnedTabs = new Set<ZardTabComponent>();

  constructor() {
    // A conditionally-rendered tab (e.g. the transient workspace-start process tab) can be
    // destroyed while active; fall back to the first displayed tab so the group never shows an
    // empty panel with no selection. A qits extension like `indicator` — preserve on regenerate.
    effect(() => {
      const tabs = this.tabs();
      const active = this.activeTab();
      if (active && !tabs.includes(active)) {
        const first = this.orderedTabs()[0];
        if (first) {
          this.setActiveTab(first);
        }
      }
    });

    // A pinned tab that appears after init auto-selects itself (its point is to lead while it
    // exists); the mount-time default in ngAfterViewInit covers one already present. Tracked per
    // component instance, so re-renders of the same tab never re-steal a user's selection.
    effect(() => {
      const pinned = this.tabs().filter(tab => tab.zPinFirst());
      const fresh = pinned.find(tab => !this.seenPinnedTabs.has(tab));
      this.seenPinnedTabs = new Set(pinned);
      if (fresh && this.activeTab() !== null) {
        this.setActiveTab(fresh);
      }
    });
  }

  ngAfterViewInit(): void {
    // default tab selection: the first *displayed* tab, honoring a persisted order
    const first = this.orderedTabs()[0];
    if (first) {
      this.setActiveTab(first);
    }

    runInInjectionContext(this.injector, () => {
      const observeInputs$ = merge(
        toObservable(this.zShowArrow),
        toObservable(this.tabs),
        toObservable(this.zTabsPosition),
      );

      // Re-observe whenever #tabNav reference changes (e.g., when placement toggles)
      let observedEl: HTMLElement | null = null;
      const tabNavEl$ = toObservable(this.tabsContainer).pipe(
        map(ref => ref.nativeElement as HTMLElement),
        distinctUntilChanged(),
      );

      afterNextRender(() => {
        // SSR/browser guard
        if (!this.window || typeof ResizeObserver === 'undefined') {
          return;
        }

        const resizeObserver = new ResizeObserver(() => this.setScrollState());

        tabNavEl$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(el => {
          if (observedEl) {
            resizeObserver.unobserve(observedEl);
          }
          observedEl = el;
          resizeObserver.observe(el);
          this.setScrollState();
        });

        merge(observeInputs$, fromEvent(this.window, 'resize'))
          .pipe(debounceTime(10), takeUntilDestroyed(this.destroyRef))
          .subscribe(() => this.setScrollState());

        this.destroyRef.onDestroy(() => resizeObserver.disconnect());
      });
    });
  }

  private setScrollState(): void {
    if (this.hasScroll() !== this.scrollPresent()) {
      this.scrollPresent.set(this.hasScroll());
    }
  }

  private hasScroll(): boolean {
    const navElement: HTMLElement = this.tabsContainer().nativeElement;
    if (this.zShowArrow()) {
      return navElement.scrollWidth > navElement.clientWidth || navElement.scrollHeight > navElement.clientHeight;
    }
    return false;
  }

  /** Emitted indices are positions in the *displayed* (possibly reordered) tab row. */
  protected setActiveTab(tab: ZardTabComponent) {
    const previous = this.activeTab();
    if (previous && previous !== tab) {
      this.zDeselect.emit({
        index: this.orderedTabs().indexOf(previous),
        label: previous.label(),
        tab: previous,
      });
    }

    this.activeTab.set(tab);
    this.zTabChange.emit({
      index: this.orderedTabs().indexOf(tab),
      label: tab.label(),
      tab,
    });
  }

  protected onTabDrop(event: CdkDragDrop<unknown>) {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const labels = this.orderedTabs().map(tab => tab.label());
    moveItemInArray(labels, event.previousIndex, event.currentIndex);
    this.order.set(labels);
    const key = this.zReorderKey();
    if (key && this.window) {
      try {
        this.window.localStorage.setItem(key, JSON.stringify(labels));
      } catch {
        // Persistence is best-effort (quota, private mode); the session keeps the new order.
      }
    }
  }

  protected readonly navBeforeContent = computed(() => {
    const position = this.zTabsPosition();
    return position === 'top' || position === 'left';
  });

  protected readonly isHorizontal = computed(() => {
    const position = this.zTabsPosition();
    return position === 'top' || position === 'bottom';
  });

  protected readonly navGridClasses = computed(() => {
    const gridLayout = this.isHorizontal() ? 'grid-cols-[25px_1fr_25px]' : 'grid-rows-[25px_1fr_25px]';
    if (this.showArrow()) {
      return twMerge(clsx('grid', gridLayout));
    }
    return 'grid';
  });

  protected readonly containerClasses = computed(() =>
    twMerge(tabContainerVariants({ zPosition: this.zTabsPosition() }), this.class()),
  );

  protected readonly navClasses = computed(() =>
    tabNavVariants({ zPosition: this.zTabsPosition(), zAlignTabs: this.showArrow() ? 'start' : this.zAlignTabs() }),
  );

  protected readonly buttonClassesSignal = computed(() => {
    const active = this.activeTab();
    const position = this.zActivePosition();
    return new Map(
      this.tabs().map(tab => [tab, tabButtonVariants({ zActivePosition: position, isActive: tab === active })]),
    );
  });

  protected scrollNav(direction: 'left' | 'right' | 'up' | 'down') {
    const container = this.tabsContainer().nativeElement;
    const scrollAmount = this.zScrollAmount();
    if (direction === 'left') {
      container.scrollLeft -= scrollAmount;
    } else if (direction === 'right') {
      container.scrollLeft += scrollAmount;
    } else if (direction === 'up') {
      container.scrollTop -= scrollAmount;
    } else if (direction === 'down') {
      container.scrollTop += scrollAmount;
    }
  }

  /** Selects by position in the displayed (possibly reordered) tab row. */
  selectTabByIndex(index: number): void {
    const tab = this.orderedTabs()[index];
    if (tab) {
      this.setActiveTab(tab);
    } else {
      console.warn(`Index ${index} outside the range of available tabs.`);
    }
  }

  selectTabByLabel(label: string): void {
    const tab = this.tabs().find(tab => tab.label() === label);
    if (tab) {
      this.setActiveTab(tab);
    } else {
      console.warn(`No tab labelled "${label}" among the available tabs.`);
    }
  }
}
