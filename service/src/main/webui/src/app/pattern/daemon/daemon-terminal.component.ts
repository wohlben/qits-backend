import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideSquareTerminal, lucideX } from '@ng-icons/lucide';

import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';

/**
 * The daemon interactive terminal: a per-daemon "Terminal" button that opens a fullscreen dialog
 * framing an xterm.js attached to the daemon's tmux session through the
 * `/api/terminal/daemons/{repoId}/{workspaceId}/{daemonId}` socket (the interactive half of
 * Increment 2 of tmux-backed daemons — real input/resize, e.g. Quarkus dev's `[r]`/`[e]` keys).
 * Rendered only for a live daemon; closing the dialog detaches the tmux client and leaves the
 * daemon running. Mirrors the daemon web-view's overlay recipe.
 */
@Component({
  selector: 'app-daemon-terminal',
  imports: [NgIcon, ZardButtonComponent, WebTerminalComponent],
  template: `
    <button
      z-button
      zType="ghost"
      zSize="sm"
      type="button"
      (click)="open()"
      [attr.aria-label]="'Open a terminal for ' + name()"
    >
      <ng-icon name="lucideSquareTerminal" class="size-4" />
      Terminal
    </button>

    <ng-template #terminalTpl>
      <div class="flex h-full min-h-0 flex-col">
        <div class="flex items-center gap-2 border-b p-2">
          <ng-icon name="lucideSquareTerminal" class="size-4" />
          <span class="text-sm font-medium">{{ name() }}</span>
          <span class="flex-1"></span>
          <button
            z-button
            zType="ghost"
            zSize="sm"
            type="button"
            (click)="close()"
            aria-label="Close the terminal"
          >
            <ng-icon name="lucideX" class="size-4" />
          </button>
        </div>

        <div class="min-h-0 flex-1 p-2">
          <app-web-terminal [socketPath]="socketPath()" />
        </div>
      </div>
    </ng-template>
  `,
  viewProviders: [provideIcons({ lucideSquareTerminal, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonTerminalComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  readonly daemonId = input.required<string>();
  readonly name = input.required<string>();

  private readonly dialog = inject(ZardDialogService);
  private readonly terminalTpl = viewChild<TemplateRef<unknown>>('terminalTpl');
  private dialogRef: ZardDialogRef<unknown> | null = null;

  /** The interactive-attach WS path (relative to origin; the backend gates on daemon liveness). */
  readonly socketPath = computed(
    () => `api/terminal/daemons/${this.repoId()}/${this.workspaceId()}/${this.daemonId()}`,
  );

  open() {
    const content = this.terminalTpl();
    if (!content) {
      return;
    }
    // Fullscreen, no backdrop-close (losing an interactive terminal to a stray click is jarring;
    // the header has an explicit close) — same overlay recipe as the daemon web view.
    this.dialogRef = this.dialog.create({
      zContent: content,
      zHideFooter: true,
      zMaskClosable: false,
      zCustomClasses:
        'left-0 top-0 translate-x-0 translate-y-0 h-dvh w-screen max-w-none rounded-none p-0 gap-0 grid-rows-[minmax(0,1fr)]',
    });
  }

  close() {
    this.dialogRef?.close();
    this.dialogRef = null;
  }
}
