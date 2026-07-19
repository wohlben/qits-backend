import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { SyncStatusDto } from '@/api/model/syncStatusDto';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardSelectImports } from '@/shared/components/select/select.imports';

/**
 * Presentational sync bar shown below the repository header. Surfaces the repository's main
 * branch (configurable here), its ahead/behind state versus the remote, and the Pull / Sync /
 * Push actions. All data and mutations are owned by the smart parent, which passes pending
 * flags down and reacts to the outputs.
 */
@Component({
  selector: 'app-repository-sync-bar',
  imports: [ZardButtonComponent, ZardSelectImports],
  template: `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border p-3">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium">Main branch</span>
        <z-select
          zLabel="Main branch"
          zPlaceholder="Select branch…"
          [zValue]="branch()"
          [zDisabled]="busy()"
          (zSelectionChange)="onSelect($event)"
        >
          @for (b of branches(); track b) {
            <z-select-item [zValue]="b">{{ b }}</z-select-item>
          }
        </z-select>
      </div>

      <div class="text-sm" aria-live="polite">
        @if (statusPending()) {
          <span class="text-muted-foreground">Checking remote…</span>
        } @else if (status(); as s) {
          @if (!s.remoteReachable) {
            <span class="text-destructive">Remote unreachable</span>
          } @else if (!s.remoteExists) {
            <span class="text-muted-foreground">Branch not on remote yet</span>
          } @else if (s.ahead === 0 && s.behind === 0) {
            <span class="text-muted-foreground">Up to date with remote</span>
          } @else {
            <span class="inline-flex items-center gap-2 font-mono">
              <span class="text-foreground" title="commits ahead of remote">↑{{ s.ahead ?? '?' }}</span>
              <span class="text-foreground" title="commits behind remote">↓{{ s.behind ?? '?' }}</span>
            </span>
          }
        }
      </div>

      <div class="ml-auto flex items-center gap-2">
        <button z-button zType="secondary" [zLoading]="pullPending()" [zDisabled]="busy()" (click)="pull.emit()">
          Pull
        </button>
        <button z-button [zLoading]="syncPending()" [zDisabled]="busy()" (click)="sync.emit()">Sync</button>
        <button z-button zType="secondary" [zLoading]="pushPending()" [zDisabled]="busy()" (click)="push.emit()">
          Push
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepositorySyncBarComponent {
  readonly branch = input<string>('');
  readonly branches = input<string[]>([]);
  readonly status = input<SyncStatusDto | null>(null);
  readonly statusPending = input(false);
  readonly pullPending = input(false);
  readonly syncPending = input(false);
  readonly pushPending = input(false);
  readonly mainBranchPending = input(false);
  /** A pull/sync process is live for the repo (survives the dialog closing) — keeps the bar locked. */
  readonly processActive = input(false);

  readonly mainBranchChange = output<string>();
  readonly pull = output<void>();
  readonly sync = output<void>();
  readonly push = output<void>();

  /** Any in-flight git/config operation blocks the controls to avoid overlapping commands. */
  readonly busy = computed(
    () =>
      this.processActive() ||
      this.pullPending() ||
      this.syncPending() ||
      this.pushPending() ||
      this.mainBranchPending(),
  );

  onSelect(value: string | string[]) {
    const branch = Array.isArray(value) ? value[0] : value;
    if (branch && branch !== this.branch()) {
      this.mainBranchChange.emit(branch);
    }
  }
}
