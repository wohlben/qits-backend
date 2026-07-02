import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMic, lucideSparkles, lucideSquare } from '@ng-icons/lucide';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { ZardButtonComponent } from '@/shared/components/button';
import { SpeechTranscriber } from './speech-transcriber';

/**
 * The speak-to-prompt flow for a worktree: record speech (transcribed locally in the browser by
 * Moonshine — audio never leaves the machine), edit the transcript, have a small Claude model
 * rewrite it into a coherent agent prompt, then launch the worktree's agent with that prompt and
 * jump to its chat.
 */
@Component({
  selector: 'app-speak-to-prompt',
  imports: [ZardButtonComponent, NgIcon],
  template: `
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-2">
        <div class="flex items-center gap-3">
          <button
            z-button
            [zType]="recording() ? 'destructive' : 'default'"
            [zLoading]="recorder.status() === 'loading'"
            (click)="toggleRecording()"
          >
            <ng-icon [name]="recording() ? 'lucideSquare' : 'lucideMic'" class="size-4" />
            {{ recording() ? 'Stop recording' : 'Record' }}
          </button>
          @if (recorder.status() === 'loading') {
            <span class="text-sm text-muted-foreground">
              Loading speech model (downloads ~60 MB on first use)…
            </span>
          } @else if (recording()) {
            <span class="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                class="inline-block size-2 rounded-full"
                [class]="recorder.speaking() ? 'animate-pulse bg-destructive' : 'bg-muted-foreground'"
              ></span>
              {{
                recorder.speaking()
                  ? 'Listening…'
                  : 'Speak now — text is committed at every pause'
              }}
            </span>
            <!-- Live input level: if this stays flat while speaking, no audio reaches the page. -->
            <span
              class="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
              title="Microphone input level"
            >
              <span
                class="block h-full rounded-full bg-primary transition-[width] duration-75"
                [style.width.%]="recorder.level() * 100"
              ></span>
            </span>
          }
        </div>
        @if (recorder.error(); as err) {
          <div class="text-sm text-destructive">Recording failed: {{ err }}</div>
        }

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Transcript</span>
          <textarea
            rows="6"
            class="rounded-md border bg-background p-2 text-sm"
            placeholder="Press Record and describe what should happen in this worktree…"
            [value]="transcript()"
            (input)="transcript.set(transcriptArea.value)"
            #transcriptArea
          ></textarea>
        </label>

        <div class="flex items-center gap-2">
          <button
            z-button
            [zDisabled]="!transcript().trim() || refineMutation.isPending()"
            [zLoading]="refineMutation.isPending()"
            (click)="refineMutation.mutate(transcript())"
          >
            <ng-icon name="lucideSparkles" class="size-4" />
            Refine into prompt
          </button>
          <button
            z-button
            zType="secondary"
            [zDisabled]="!transcript().trim()"
            (click)="refinedPrompt.set(transcript())"
          >
            Use transcript as-is
          </button>
          @if (refineMutation.isPending()) {
            <span class="text-sm text-muted-foreground">Asking a small model to clean it up…</span>
          }
        </div>
        @if (refineMutation.isError()) {
          <div class="text-sm text-destructive">
            Failed to refine the prompt — is the claude CLI available on the server?
          </div>
        }
      </section>

      @if (refinedPrompt() !== null) {
        <section class="flex flex-col gap-2">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium">Prompt for the agent</span>
            <textarea
              rows="10"
              class="rounded-md border bg-background p-2 text-sm"
              [value]="refinedPrompt()"
              (input)="refinedPrompt.set(promptArea.value)"
              #promptArea
            ></textarea>
          </label>
          <div class="flex items-center gap-2">
            <button
              z-button
              [zDisabled]="!refinedPrompt()?.trim() || launchMutation.isPending()"
              [zLoading]="launchMutation.isPending()"
              (click)="launch()"
            >
              Launch agent with this prompt
            </button>
          </div>
          @if (launchMutation.isError()) {
            <div class="text-sm text-destructive">Failed to launch the agent</div>
          }
        </section>
      }
    </div>
  `,
  viewProviders: [provideIcons({ lucideMic, lucideSquare, lucideSparkles })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeakToPromptComponent {
  readonly repoId = input.required<string>();
  readonly worktreeId = input.required<string>();

  private readonly refinementService = inject(PromptRefinementControllerService);
  private readonly agentService = inject(AgentControllerService);
  private readonly router = inject(Router);

  readonly transcript = signal('');
  /** Null until a refinement (or "as-is") produced something — gates the launch section. */
  readonly refinedPrompt = signal<string | null>(null);

  /** Utterances append as you pause; commits landing shortly after stop still append. */
  readonly recorder = new SpeechTranscriber((text) =>
    this.transcript.update((prev) => (prev ? prev + ' ' + text : text)),
  );

  recording() {
    return this.recorder.status() === 'recording';
  }

  toggleRecording() {
    if (this.recording()) {
      this.recorder.stop();
    } else {
      void this.recorder.start();
    }
  }

  readonly refineMutation = injectMutation(() => ({
    mutationFn: (transcript: string) =>
      lastValueFrom(
        this.refinementService.apiRepositoriesRepoIdWorktreesWorktreeIdPromptRefinementsPost(
          this.repoId(),
          this.worktreeId(),
          { transcript },
        ),
      ),
    onSuccess: (res) => this.refinedPrompt.set(res.prompt ?? ''),
  }));

  readonly launchMutation = injectMutation(() => ({
    mutationFn: (prompt: string) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorktreesWorktreeIdAgentsPost(
          this.repoId(),
          this.worktreeId(),
          { scope: AgentMcpScope.Repository, initialContext: prompt },
        ),
      ),
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.router.navigate(['/commands', commandId]);
      }
    },
  }));

  launch() {
    const prompt = this.refinedPrompt()?.trim();
    if (!prompt) return;
    this.recorder.stop();
    this.launchMutation.mutate(prompt);
  }
}
