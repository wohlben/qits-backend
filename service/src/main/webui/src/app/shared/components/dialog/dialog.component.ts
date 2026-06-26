import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Minimal modal dialog. Renders a centered panel over a backdrop when `open` is true.
 * Closes on backdrop click, the close button, or Escape. Two-way bindable via `[(open)]`.
 *
 * ```html
 * <z-dialog [(open)]="isOpen" zTitle="Title">
 *   <p>Body content</p>
 * </z-dialog>
 * ```
 */
@Component({
  selector: 'z-dialog',
  imports: [A11yModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="fixed inset-0 bg-black/50" (click)="close()" aria-hidden="true"></div>

        <div
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="zTitle()"
          class="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg"
        >
          <div class="flex items-start justify-between gap-4">
            <h2 class="text-lg font-semibold">{{ zTitle() }}</h2>
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground"
              (click)="close()"
            >
              <span aria-hidden="true">✕</span>
              <span class="sr-only">Close</span>
            </button>
          </div>

          <ng-content />
        </div>
      </div>
    }
  `,
  host: {
    '(keydown.escape)': 'close()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZardDialogComponent {
  readonly open = model(false);
  readonly zTitle = input('');

  close() {
    this.open.set(false);
  }
}
