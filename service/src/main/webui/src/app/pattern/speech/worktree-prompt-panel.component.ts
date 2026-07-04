import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { MarkdownComponent } from '@/ui/components/markdown/markdown.component';
import { SpeakToPromptComponent } from './speak-to-prompt.component';

/**
 * The "decide what to do in this worktree" panel: the worktree's goal (preamble) followed by the
 * speak-to-prompt flow. Shared between the WIP route (which navigates to the command on launch)
 * and the worktree chat dialog (which renders the chat in place instead).
 */
@Component({
  selector: 'app-worktree-prompt-panel',
  imports: [SpeakToPromptComponent, MarkdownComponent],
  template: `
    <div class="flex flex-col gap-6">
      @if (preamble(); as text) {
        <section class="rounded-lg border bg-muted/30 p-4">
          <h2 class="mb-2 text-sm font-medium text-muted-foreground">Goal of this worktree</h2>
          <app-markdown [text]="text" />
        </section>
      }

      <app-speak-to-prompt
        [repoId]="repoId()"
        [worktreeId]="worktreeId()"
        [navigateOnLaunch]="navigateOnLaunch()"
        (launched)="launched.emit($event)"
      />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorktreePromptPanelComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();
  readonly preamble = input<string | null>(null);
  readonly navigateOnLaunch = input(true);
  readonly launched = output<string>();
}
