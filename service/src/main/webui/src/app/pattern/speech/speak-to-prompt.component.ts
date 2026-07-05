import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMic, lucideSparkles, lucideSquare } from '@ng-icons/lucide';
import { injectMutation } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { SpeechControllerService } from '@/api/api/speechController.service';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { ZardButtonComponent } from '@/shared/components/button';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { formatSnippetsForPrompt } from '@/shared/state/snippet-format';
import { WavRecorder } from './wav-recorder';

/**
 * The speak-to-prompt flow for a workspace: record speech (transcribed server-side by Parakeet),
 * edit the transcript, have a small Claude model rewrite it into a coherent agent prompt, then
 * launch the workspace's agent with that prompt and jump to its chat.
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
            (click)="toggleRecording()"
          >
            <ng-icon [name]="recording() ? 'lucideSquare' : 'lucideMic'" class="size-4" />
            {{ recording() ? 'Stop recording' : 'Record' }}
          </button>
          @if (recording()) {
            <span class="text-sm text-muted-foreground">
              Speak — text appears after each pause
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
          @if (transcribeMutation.isPending()) {
            <span class="text-sm text-muted-foreground">Transcribing…</span>
          }
        </div>
        @if (recorder.error(); as err) {
          <div class="text-sm text-destructive">Recording failed: {{ err }}</div>
        }
        @if (transcribeMutation.isError()) {
          <div class="text-sm text-destructive">
            Transcription failed — the speech runtime may still be downloading its model on the
            server (first use); check the server logs and try again.
          </div>
        }

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium">Transcript</span>
          <textarea
            rows="6"
            class="rounded-md border bg-background p-2 text-sm"
            placeholder="Press Record and describe what should happen in this workspace…"
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

      <!-- Elements picked from a daemon web view; all listed snippets ride along with the launch
           (remove the ones you don't want). The cache is root-scoped and survives navigation. -->
      @if (promptContext.count() > 0) {
        <section class="flex flex-col gap-2">
          <span class="text-sm font-medium">Picked elements (attached to the prompt)</span>
          @for (snippet of promptContext.snippets(); track snippet.id) {
            <div class="flex items-center gap-2 rounded-md border p-2 text-sm">
              <code class="text-xs text-muted-foreground">&lt;{{ snippet.tag }}&gt;</code>
              <span class="flex-1 truncate" [title]="snippet.selector">
                {{ snippet.textPreview || snippet.selector }}
              </span>
              <button
                z-button
                zType="ghost"
                type="button"
                (click)="promptContext.remove(snippet.id)"
                [attr.aria-label]="'Remove picked element ' + snippet.tag"
              >
                Remove
              </button>
            </div>
          }
        </section>
      }

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
  readonly workspaceId = input.required<string>();
  /** Off when a host (e.g. the chat dialog) renders the launched chat in place instead. */
  readonly navigateOnLaunch = input(true);
  /** Emits the launched command's id — always, whether or not we also navigate. */
  readonly launched = output<string>();

  private readonly speechService = inject(SpeechControllerService);
  private readonly refinementService = inject(PromptRefinementControllerService);
  private readonly agentService = inject(AgentControllerService);
  private readonly router = inject(Router);
  protected readonly promptContext = inject(PromptContextStore);

  readonly transcript = signal('');
  /** Null until a refinement (or "as-is") produced something — gates the launch section. */
  readonly refinedPrompt = signal<string | null>(null);

  /** Utterance segments stream in while recording; uploads are serialized to keep text order. */
  readonly recorder = new WavRecorder((audioBase64) => this.enqueueSegment(audioBase64));

  private uploadQueue: Promise<unknown> = Promise.resolve();

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

  private enqueueSegment(audioBase64: string) {
    this.uploadQueue = this.uploadQueue.then(() =>
      this.transcribeMutation.mutateAsync(audioBase64).catch(() => undefined),
    );
  }

  readonly transcribeMutation = injectMutation(() => ({
    mutationFn: (audioBase64: string) =>
      lastValueFrom(this.speechService.apiSpeechTranscriptionsPost({ audioBase64 })),
    onSuccess: (res) => {
      const text = res.text?.trim();
      if (text) {
        this.transcript.update((prev) => (prev ? prev + ' ' + text : text));
      }
    },
  }));

  readonly refineMutation = injectMutation(() => ({
    mutationFn: (transcript: string) =>
      lastValueFrom(
        this.refinementService.apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptRefinementsPost(
          this.repoId(),
          this.workspaceId(),
          { transcript },
        ),
      ),
    onSuccess: (res) => this.refinedPrompt.set(res.prompt ?? ''),
  }));

  readonly launchMutation = injectMutation(() => ({
    mutationFn: (prompt: string) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId(),
          this.workspaceId(),
          { scope: AgentMcpScope.Repository, initialContext: prompt },
        ),
      ),
    onSuccess: (res) => {
      const commandId = res.command?.id;
      if (commandId) {
        this.launched.emit(commandId);
        if (this.navigateOnLaunch()) {
          this.router.navigate(['/commands', commandId]);
        }
      }
    },
  }));

  launch() {
    const prompt = this.refinedPrompt()?.trim();
    if (!prompt) return;
    const snippets = this.promptContext.snippets();
    const context = snippets.length ? prompt + '\n\n' + formatSnippetsForPrompt(snippets) : prompt;
    this.launchMutation.mutate(context);
  }
}
