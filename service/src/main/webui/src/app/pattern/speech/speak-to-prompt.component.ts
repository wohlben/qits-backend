import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMic, lucideSparkles, lucideSquare } from '@ng-icons/lucide';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { AgentsControllerService } from '@/api/api/agentsController.service';
import { PromptRefinementControllerService } from '@/api/api/promptRefinementController.service';
import { SpeechControllerService } from '@/api/api/speechController.service';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { AgentType } from '@/api/model/agentType';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { AgentTypeInputComponent } from '@/ui/inputs/agents/agent-type-input.component';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { codeReferenceLabel } from '@/shared/state/snippet-format';
import { blobToAttachment, imageBlobFromClipboard } from '@/shared/utils/image-attach';
import { WavRecorder } from './wav-recorder';

/**
 * The speak-to-prompt flow for a workspace: record speech (transcribed server-side by Parakeet),
 * edit the transcript, have a small Claude model rewrite it into a coherent agent prompt, then
 * launch the workspace's agent with that prompt and jump to its chat.
 */
@Component({
  selector: 'app-speak-to-prompt',
  imports: [AgentTypeInputComponent, ZardButtonComponent, NgIcon, RouterLink],
  template: `
    <div class="flex flex-col gap-6">
      <!-- A draft composed earlier (this or another device) was restored from the backend. Cheap
           insurance against stale context silently riding into a launch; dismissed on first edit. -->
      @if (promptContext.justRestored()) {
        <div
          class="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        >
          <span>Restored draft{{ restoredAgo() }}.</span>
          <button
            z-button
            zType="ghost"
            zSize="sm"
            type="button"
            (click)="discard()"
          >
            Discard
          </button>
        </div>
      }

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
            (click)="useTranscriptAsIs()"
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
            <div class="flex flex-col gap-0.5 rounded-md border p-2 text-sm">
              <div class="flex items-center gap-2">
                <code class="text-xs text-muted-foreground">&lt;{{ snippet.tag }}&gt;</code>
                @if (snippet.component; as component) {
                  <code class="text-xs font-medium">
                    {{ component.className }} ({{ component.selector }})
                  </code>
                }
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
              <!-- The attribution the prompt will carry: pick-time route, source files, chain. -->
              @if (snippet.appPath || snippet.component) {
                <div class="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                  @if (snippet.appPath; as appPath) {
                    <span [title]="snippet.url">{{ appPath }}</span>
                  }
                  @if (snippet.component; as component) {
                    <!-- Each source file deep-links into the Files tab; the browser seeds its
                         filter from ?path= and opens the closest match (stale paths tolerated). -->
                    <span class="flex min-w-0 flex-wrap gap-x-1 truncate font-mono">
                      @for (file of component.files; track file; let last = $last) {
                        <a
                          class="hover:underline"
                          [routerLink]="[
                            '/repositories',
                            repoId(),
                            'workspaces',
                            workspaceId(),
                            'files',
                          ]"
                          [queryParams]="{ path: file }"
                          [title]="'Open ' + file + ' in the file browser'"
                          >{{ file }}{{ last ? '' : ',' }}</a
                        >
                      }
                    </span>
                    @if (component.ancestors; as ancestors) {
                      <span>in {{ ancestors.join(' › ') }}</span>
                    }
                  }
                </div>
              }
            </div>
          }
        </section>
      }

      <!-- Code references selected in the Files tab; they ride along with the launch the same way
           picked elements do. Each row deep-links back to the file at its selected lines. -->
      @if (promptContext.references().length > 0) {
        <section class="flex flex-col gap-2">
          <span class="text-sm font-medium">Selected code (attached to the prompt)</span>
          @for (ref of promptContext.references(); track refLabel(ref)) {
            <div class="flex flex-col gap-1 rounded-md border p-2 text-sm">
              <div class="flex items-center gap-2">
                <a
                  class="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
                  [routerLink]="['/repositories', repoId(), 'workspaces', workspaceId(), 'files']"
                  [queryParams]="{ path: ref.path, lines: ref.startLine + '-' + ref.endLine }"
                  [title]="'Open ' + refLabel(ref) + ' in the file browser'"
                  >{{ refLabel(ref) }}</a
                >
                <button
                  z-button
                  zType="ghost"
                  type="button"
                  (click)="promptContext.removeReference(ref)"
                  [attr.aria-label]="'Remove reference ' + refLabel(ref)"
                >
                  Remove
                </button>
              </div>
              <!-- A pick-time preview so the user sees *what* they attached; the launch prompt
                   still carries only the path:lines label (the agent reads the file itself). -->
              @if (ref.excerpt !== undefined && ref.excerpt !== '') {
                <pre
                  class="max-h-40 overflow-auto rounded bg-muted p-2 font-mono text-xs"
                >{{ ref.excerpt }}</pre>
              }
            </div>
          }
        </section>
      }

      <!-- Images attached to the prompt: pasted screenshots (and, from the Sketch tab, drawings).
           They ride the launch via the taskPrompt MCP tool the same way picks/references do. -->
      @if (promptContext.images().length > 0) {
        <section class="flex flex-col gap-2">
          <span class="text-sm font-medium">Images (attached to the prompt)</span>
          @for (img of promptContext.images(); track img.id) {
            <div class="flex items-center gap-2 rounded-md border p-2 text-sm">
              <img
                [src]="'data:' + img.mimeType + ';base64,' + img.dataBase64"
                class="size-16 rounded object-cover"
                alt=""
              />
              <span class="min-w-0 flex-1 truncate">{{ img.label }}</span>
              <button
                z-button
                zType="ghost"
                type="button"
                (click)="removeImage(img.id)"
                [attr.aria-label]="'Remove image ' + img.label"
              >
                Remove
              </button>
            </div>
          }
        </section>
      }
      @if (attachError()) {
        <p class="text-sm text-destructive">
          Couldn't attach the image — it may be larger than the size limit. Try a smaller image.
        </p>
      }

      @if (launchSectionVisible()) {
        <section class="flex flex-col gap-2">
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium">Prompt for the agent</span>
            <!-- Paste an image here to attach it (screenshots, design exports); text paste is normal. -->
            <textarea
              rows="10"
              class="rounded-md border bg-background p-2 text-sm"
              [value]="promptContext.promptText()"
              (input)="promptContext.setPromptText(promptArea.value)"
              (paste)="onPaste($event)"
              #promptArea
            ></textarea>
          </label>
          @if (availableAgents().length > 0) {
            <app-agent-type-input
              [agents]="availableAgents()"
              [value]="selectedAgent()"
              (valueChange)="selectedAgent.set($event)"
            />
          }
          <div class="flex items-center gap-2">
            <button
              z-button
              [zDisabled]="!promptContext.promptText().trim() || launchMutation.isPending()"
              [zLoading]="launchMutation.isPending()"
              (click)="launch(AgentLaunchMode.Chat)"
            >
              Launch agent with this prompt
            </button>
            <button
              z-button
              zType="secondary"
              [zDisabled]="!promptContext.promptText().trim() || launchMutation.isPending()"
              (click)="launch(AgentLaunchMode.Interactive)"
              title="The full Claude Code TUI in a terminal instead of the chat view"
            >
              Launch as terminal session
            </button>
          </div>
          @if (saveFailed()) {
            <div class="text-sm text-destructive">
              Couldn't save the prompt, so the agent wasn't launched. Check your connection and try
              again.
            </div>
          }
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
  private readonly agentsService = inject(AgentsControllerService);
  private readonly router = inject(Router);
  protected readonly promptContext = inject(PromptContextStore);
  /** Route-scoped draft sync (provided by the host page) — flushed before a fetch-model launch. */
  private readonly promptDraftSync = inject(PromptDraftSyncService);
  /** Template alias: the `path:start[-end]` label a reference renders (and tracks) as. */
  protected readonly refLabel = codeReferenceLabel;

  /** The coding-agent harnesses this instance can launch, plus the configured default. */
  readonly availableAgentsQuery = injectQuery(() => ({
    queryKey: ['agents', 'available'],
    queryFn: () => lastValueFrom(this.agentsService.apiAgentsAvailableGet()),
  }));

  readonly availableAgents = computed(() => this.availableAgentsQuery.data()?.agents ?? []);

  /** The harness the launch uses; seeded from the instance default until the user overrides it. */
  readonly selectedAgent = signal<AgentType | undefined>(undefined);

  constructor() {
    effect(() => {
      const fallback = this.availableAgentsQuery.data()?.defaultAgent;
      if (fallback && this.selectedAgent() === undefined) {
        this.selectedAgent.set(fallback);
      }
    });
  }

  readonly transcript = signal('');
  /**
   * True once a refinement (or "Use transcript as-is") produced a prompt this session — gates the
   * launch section together with a restored non-empty `promptText`, so the section also appears when
   * a persisted draft is rehydrated on load (see {@link launchSectionVisible}).
   */
  readonly promptStarted = signal(false);

  /**
   * The editable prompt lives in the store (persisted per workspace); show the launch section once
   * the draft has anything worth launching — a prompt produced this session (`promptStarted`), typed
   * text, or restored/picked context (snippets/references). Gating on the whole bucket (not just
   * `promptText`) keeps the textarea + Launch buttons reachable for a restored picks-only draft, so
   * the user can add a prompt and act on it instead of only being able to Discard.
   */
  readonly launchSectionVisible = computed(
    () => this.promptStarted() || !this.promptContext.isEmpty(),
  );

  /** A relative "· 2h ago"-style suffix for the restore hint, from the draft's last-saved timestamp. */
  readonly restoredAgo = computed(() => {
    const iso = this.promptContext.lastSavedUpdatedAt();
    if (!iso) {
      return '';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (seconds < 60) {
      return ' from moments ago';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return ` from ${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return ` from ${hours}h ago`;
    }
    return ` from ${Math.floor(hours / 24)}d ago`;
  });

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
    onSuccess: (res) => {
      this.promptContext.setPromptText(res.prompt ?? '');
      this.promptStarted.set(true);
    },
  }));

  /** Skip refinement: promote the raw transcript straight into the editable prompt. */
  useTranscriptAsIs(): void {
    this.promptContext.setPromptText(this.transcript());
    this.promptStarted.set(true);
  }

  /** An image paste failed to attach (e.g. it exceeded the server's per-image size cap → 413). */
  readonly attachError = signal(false);

  /**
   * Paste an image into the prompt as an attachment instead of text. When the clipboard carries an
   * image, prevent the default text paste, downscale/encode it, and attach it to the draft; a paste
   * with no image falls through to the normal textarea paste. A failed attach (oversize/reject) is
   * surfaced rather than swallowed.
   */
  async onPaste(event: ClipboardEvent): Promise<void> {
    const blob = imageBlobFromClipboard(event.clipboardData);
    if (!blob) {
      return;
    }
    event.preventDefault();
    this.attachError.set(false);
    try {
      const { dataBase64, mimeType } = await blobToAttachment(blob);
      await this.promptDraftSync.attachImage(dataBase64, mimeType, 'paste');
    } catch {
      this.attachError.set(true);
    }
  }

  /** Remove an attached image (deletes its server row via the sync service). */
  removeImage(id: string): void {
    void this.promptDraftSync.removeImage(id);
  }

  /** Discard the whole restored draft — clears the store and deletes any attachment rows. */
  discard(): void {
    // clearAttachments captures the row ids synchronously before clear() empties the slice.
    void this.promptDraftSync.clearAttachments();
    this.promptContext.clear();
  }

  protected readonly AgentLaunchMode = AgentLaunchMode;

  readonly launchMutation = injectMutation(() => ({
    mutationFn: (mode: AgentLaunchMode) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId(),
          this.workspaceId(),
          // Fetch model: the agent pulls the composed prompt (text + any images) from the persisted
          // draft via the taskPrompt MCP tool, so no initialContext rides the launch. The bootstrap
          // turn is synthesized server-side.
          {
            scope: AgentMcpScope.Repository,
            mode,
            deliverTaskPrompt: true,
            ...(this.selectedAgent() ? { agentType: this.selectedAgent() } : {}),
          },
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

  /** A pre-launch draft flush failed — the launch was aborted rather than fetch a stale prompt. */
  readonly saveFailed = signal(false);

  async launch(mode: AgentLaunchMode) {
    if (!this.promptContext.promptText().trim()) return;
    // Persist the draft synchronously before launching: the agent fetches serialized_prompt back via
    // taskPrompt, so the debounced autosave must be flushed or a just-typed edit would race the
    // launch and the tool would serve stale/absent text. The draft's serializer is byte-identical to
    // the old inline push. Launch does not clear the draft.
    this.saveFailed.set(false);
    try {
      await this.promptDraftSync.flushNow();
    } catch {
      // The draft did not persist; launching now would fetch stale/absent instructions, so abort and
      // surface the error instead of proceeding silently.
      this.saveFailed.set(true);
      return;
    }
    this.launchMutation.mutate(mode);
  }
}
