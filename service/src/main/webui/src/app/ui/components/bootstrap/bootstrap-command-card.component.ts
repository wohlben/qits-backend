import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BootstrapCommandDto } from '@/api/model/bootstrapCommandDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { configBaseName, isConfigManaged } from '@/shared/utils/config-origin';

/**
 * One row of the repository's ordered bootstrap chain. Config-managed commands are read-only
 * (edit the committed .qits-config.yml instead) and not reorderable — their order is re-stamped
 * from file position on every ingest.
 */
@Component({
  selector: 'app-bootstrap-command-card',
  imports: [RouterLink, ZardButtonComponent],
  template: `
    <div class="flex flex-wrap items-center gap-3 px-3 py-2">
      <span class="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
        {{ position() + 1 }}.
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        @if (isConfig()) {
          <div class="flex items-center gap-2">
            <span class="truncate font-medium">{{ displayName() }}</span>
            <span
              class="inline-flex w-fit items-center rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400"
            >
              .qits-config
            </span>
          </div>
        } @else {
          <a
            [routerLink]="[
              '/repositories',
              command().repositoryId,
              'bootstrap',
              command().id,
              'edit',
            ]"
            class="truncate font-medium hover:underline"
          >
            {{ displayName() }}
          </a>
        }
        @if (command().description) {
          <span class="truncate text-xs text-muted-foreground">{{ command().description }}</span>
        }
        @if (command().checkScript) {
          <span class="text-[10px] uppercase tracking-wide text-muted-foreground">
            check-guarded
          </span>
        }
      </div>
      @if (!isConfig()) {
        <div class="flex items-center gap-1">
          <button
            z-button
            zType="ghost"
            zSize="sm"
            type="button"
            [disabled]="!canMoveUp()"
            (click)="moveUp.emit()"
            [attr.aria-label]="'Move ' + displayName() + ' up'"
          >
            ↑
          </button>
          <button
            z-button
            zType="ghost"
            zSize="sm"
            type="button"
            [disabled]="!canMoveDown()"
            (click)="moveDown.emit()"
            [attr.aria-label]="'Move ' + displayName() + ' down'"
          >
            ↓
          </button>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BootstrapCommandCardComponent {
  readonly command = input.required<BootstrapCommandDto>();
  readonly position = input.required<number>();
  readonly canMoveUp = input(false);
  readonly canMoveDown = input(false);
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();

  readonly isConfig = computed(() => isConfigManaged(this.command().origin, this.command().name));
  readonly displayName = computed(() => configBaseName(this.command().name));
}
