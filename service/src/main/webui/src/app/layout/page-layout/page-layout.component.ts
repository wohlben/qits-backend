import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  input,
  type Signal,
  TemplateRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import type { ClassValue } from 'clsx';

import { mergeClasses } from '@/shared/utils/merge-classes';

/**
 * Minimal shape of a TanStack Query result that page-layout needs
 * to render loading, error, and success states.
 *
 * Structurally compatible with `CreateBaseQueryResult` / `CreateQueryResult`.
 */
export interface PageQueryRequest<TData = unknown> {
  /** Returns true while the query is fetching for the first time. */
  isPending: () => boolean;
  /** Returns true when the query is in an error state. */
  isError: () => boolean;
  /** The latest data returned by the query (undefined while pending or if errored). */
  data: Signal<TData | undefined>;
}

@Component({
  selector: 'app-page-layout',
  imports: [NgTemplateOutlet],
  template: `
    <div class="flex h-full flex-col gap-6">
      @let req = request();
      @if (req && req.isPending()) {
        <div class="text-muted-foreground">{{ pendingText() }}</div>
      } @else if (req && req.isError()) {
        <div class="text-destructive">{{ errorText() }}</div>
      } @else {
        <header [class]="headerClasses()">
          <div class="flex flex-1 flex-col gap-1">
            @if (pageTitleTemplate(); as t) {
              <ng-container *ngTemplateOutlet="t; context: pageContext()" />
            } @else {
              <ng-content select="[pageTitle]" />
            }
          </div>

          @if (hasActions()) {
            <div class="flex items-center gap-2">
              @if (pageActionsTemplate(); as t) {
                <ng-container *ngTemplateOutlet="t; context: pageContext()" />
              } @else {
                <ng-content select="[pageActions]" />
              }
            </div>
          }
        </header>

        <div class="flex-1">
          @if (pageContentTemplate(); as t) {
            <ng-container *ngTemplateOutlet="t; context: pageContext()" />
          } @else {
            <ng-content />
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageLayoutComponent {
  readonly class = input<ClassValue>('');
  readonly hasActions = input(true);
  readonly request = input<PageQueryRequest<unknown>>();
  readonly pendingText = input('Loading…');
  readonly errorText = input('Failed to load');

  readonly pageTitleTemplate = contentChild('pageTitle', { read: TemplateRef });
  readonly pageActionsTemplate = contentChild('pageActions', { read: TemplateRef });
  readonly pageContentTemplate = contentChild('pageContent', { read: TemplateRef });

  protected readonly headerClasses = computed(() =>
    mergeClasses('flex items-start justify-between gap-4', this.class()),
  );

  protected readonly pageContext = computed(() => ({
    $implicit: this.request()?.data(),
  }));
}
