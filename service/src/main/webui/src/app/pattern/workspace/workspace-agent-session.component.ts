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
import { RouterLink } from '@angular/router';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { catchError, lastValueFrom, of } from 'rxjs';

import { AgentControllerService } from '@/api/api/agentController.service';
import { CommandControllerService } from '@/api/api/commandController.service';
import { WorkspacePromptDraftControllerService } from '@/api/api/workspacePromptDraftController.service';
import { WorkspacePromptDraftDto } from '@/api/model/workspacePromptDraftDto';
import { AgentLaunchMode } from '@/api/model/agentLaunchMode';
import { AgentMcpScope } from '@/api/model/agentMcpScope';
import { CommandDto } from '@/api/model/commandDto';
import { CommandStatus } from '@/api/model/commandStatus';
import {
  launchMillis,
  newestRunningChat,
  newestRunningInteractiveAgent,
} from '@/pattern/command/running-chat';
import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { WebTerminalComponent } from '@/pattern/repository/web-terminal.component';
import { ZardButtonComponent } from '@/shared/components/button';

/**
 * The workspace's embedded agent session: the interactive Claude Code TUI living directly in the
 * Agents tab. Nothing launches on page load — the session is expensive to materialize — so the tab
 * latches on first selection (`activated`), then resolves in order: a running interactive agent
 * run re-attaches (wherever it was started from); a running chat defers to the Chat tab (its
 * session is actively being driven — a concurrent `--resume` is exactly the collision session
 * pinning avoids); an empty history gets a fresh session; a workspace WITH history idles on an
 * explicit choice — "Start new session" here, or Resume on a row of the session list below.
 * Resuming is never automatic: the recorded last session can be gone from the agent's state (a
 * re-materialized container, pruned volume state), and an auto `--resume` of a vanished id exits
 * instantly ("No conversation found with session ID") in a loop the user never asked for
 * (docs/issues/2026-07-17_agent-tab-instant-exit-on-vanished-session.md). The tab group keeps
 * hidden tabs mounted, so the socket and the process survive tab switches — the same contract as
 * chat.
 *
 * A signed-out volume makes the launch return the sign-in REPL (a TERMINAL command with no
 * session lineage): it is a PTY like any other, so it renders here in place, and its exit re-runs
 * resolution — the next launch proceeds signed in. A finished run does NOT auto-relaunch (a
 * crashing agent would loop); the ended state offers Resume plus a link to the imported
 * transcript.
 */
@Component({
  selector: 'app-workspace-agent-session',
  imports: [RouterLink, WebTerminalComponent, ZardButtonComponent],
  template: `
    <section class="flex flex-col gap-3" aria-label="Agent session">
      <div class="flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold">Session</h2>
        @if (attachedCommandId(); as id) {
          <button
            z-button
            zType="destructive"
            [zLoading]="terminateMutation.isPending()"
            (click)="terminateMutation.mutate(id)"
          >
            Terminate
          </button>
        }
      </div>

      @if (attachedCommandId(); as id) {
        <span class="text-xs text-muted-foreground">
          Switching tabs keeps the agent running; come back to pick up the conversation.
        </span>
        <!-- Tracked by command id so a relaunch (new id) recreates the terminal — it connects
             once per component instance. -->
        @for (cid of [id]; track cid) {
          <app-web-terminal [commandId]="cid" />
        }
      } @else if (runningChat(); as chat) {
        <div class="rounded-md border px-4 py-6 text-sm text-muted-foreground">
          This workspace's conversation is live in the Chat tab.
          <button z-button zType="link" type="button" (click)="jumpToChat.emit()">
            Go to Chat
          </button>
        </div>
      } @else if (launchMutation.isPending()) {
        <div class="rounded-md border px-4 py-6 text-sm text-muted-foreground">
          Starting agent session…
        </div>
      } @else if (launchMutation.isError()) {
        <div class="flex flex-col items-start gap-2 rounded-md border px-4 py-6">
          <span class="text-sm text-destructive">Failed to launch the agent session.</span>
          <button z-button zType="secondary" type="button" (click)="retry()">Retry</button>
        </div>
      } @else if (endedCommandId(); as endedId) {
        <div class="flex flex-col items-start gap-3 rounded-md border px-4 py-6">
          <span class="text-sm text-muted-foreground">The session has ended.</span>
          <div class="flex items-center gap-2">
            <button z-button zType="secondary" type="button" (click)="resume()">Resume</button>
            <button z-button zType="secondary" type="button" (click)="startNew()">
              New session
            </button>
            <a z-button zType="link" [routerLink]="['/commands', endedId]">View transcript</a>
          </div>
        </div>
      } @else if (idle()) {
        <div class="flex flex-col items-start gap-3 rounded-md border px-4 py-6">
          <span class="text-sm text-muted-foreground">No agent session is running.</span>
          <button z-button zType="secondary" type="button" (click)="startNew()">
            Start new session
          </button>
          <span class="text-xs text-muted-foreground">
            Or resume one of the previous sessions from the list below.
          </span>
        </div>
      } @else {
        <div class="rounded-md border px-4 py-6 text-sm text-muted-foreground">
          Resolving the workspace's agent session…
        </div>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceAgentSessionComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  /** Latched true by the page on the Agents tab's first selection; gates the launch side effect. */
  readonly activated = input.required<boolean>();

  /** The deferred state's jump link — the page switches the tab group to Chat. */
  readonly jumpToChat = output<void>();

  private readonly agentService = inject(AgentControllerService);
  private readonly commandService = inject(CommandControllerService);
  private readonly draftService = inject(WorkspacePromptDraftControllerService);
  /** Route-scoped, shared with the compose tab — flushed before a fresh launch (see {@link launch}). */
  private readonly promptDraftSync = inject(PromptDraftSyncService);
  private readonly queryClient = inject(QueryClient);

  // Same key AND shape as the page's commands query, so both share one cache entry.
  readonly commandsQuery = injectQuery(() => ({
    queryKey: ['commands'],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsGet()).then(
        (r) => r.entries?.map((e) => e.command!).filter((c): c is CommandDto => !!c) ?? [],
      ),
  }));

  /**
   * The workspace's persisted prompt draft, keyed identically to {@code PromptDraftSyncService} so
   * this shares the page's already-hydrated cache entry (no extra fetch on tab open). Drives whether
   * a fresh auto-launch delivers the composed prompt. 404 (never saved) maps to `null`.
   */
  readonly draftQuery = injectQuery(() => ({
    queryKey: ['workspace-prompt-draft', this.repoId(), this.workspaceId()],
    queryFn: (): Promise<WorkspacePromptDraftDto | null> =>
      lastValueFrom(
        this.draftService
          .apiRepositoriesRepoIdWorkspacesWorkspaceIdPromptDraftGet(this.repoId(), this.workspaceId())
          .pipe(
            catchError((err: unknown) => {
              if (err && typeof err === 'object' && (err as { status?: number }).status === 404) {
                return of(null);
              }
              throw err;
            }),
          ),
      ),
  }));

  /**
   * Whether the workspace has a composed prompt that hasn't been handed to an agent at its current
   * version — a non-blank {@code serializedPrompt} whose {@code promptVersion} is newer than the
   * last delivered one. A fresh auto-launch delivers it once; re-attaching an already-run version
   * does not (the backend's run-tracking is the source of truth this reads back). {@link launch}
   * refetches the draft before reading this, so it reflects a just-saved edit.
   *
   * <p>NOTE: the backend's {@code hasDeliverablePrompt} also delivers an <em>attachments-only</em>
   * draft (image, no text), which this deliberately does not detect — the DTO carries no attachment
   * signal and no UI creates such a draft yet. Aligning the two (an attachment-count field feeding
   * this check) is part of the sketch/image-attachment work (steps 6–7), where attachments first
   * become composable.
   */
  readonly hasUnrunDraft = computed(() =>
    WorkspaceAgentSessionComponent.isUnrunDraft(this.draftQuery.data()),
  );

  /** The un-run predicate, shared by {@link hasUnrunDraft} and the fresh refetch result in launch. */
  private static isUnrunDraft(draft: WorkspacePromptDraftDto | null | undefined): boolean {
    if (!draft || !draft.serializedPrompt || draft.serializedPrompt.trim() === '') {
      return false;
    }
    return (draft.promptVersion ?? 0) > (draft.lastRunPromptVersion ?? -1);
  }

  /** Bridges the invalidation gap between launching from this tab and the registry reporting it. */
  readonly launchedCommandId = signal<string | null>(null);

  /** One-shot: the launch side effect runs once per tab activation; attach stays live-computed. */
  private readonly resolutionLatch = signal(false);

  /** Nothing runs and the workspace has history — waiting for the user's explicit choice. */
  readonly idle = signal(false);

  /**
   * The resume id of the last launch this tab initiated (null = fresh), replayed after a sign-in
   * REPL exit so completing OAuth continues what the user actually asked for.
   */
  private lastLaunchIntent: string | null = null;

  /** The last command this tab embedded — what the ended state refers to once nothing runs. */
  private readonly lastAttachedId = signal<string | null>(null);

  /** Sign-in REPL exits already handled (each re-runs resolution exactly once). */
  private readonly handledLoginExits = new Set<string>();

  /** A live chat owns the workspace's conversation — the embed defers instead of launching. */
  readonly runningChat = computed(() =>
    newestRunningChat(this.commandsQuery.data(), this.workspaceId()),
  );

  /**
   * The command the embedded terminal attaches to: the newest running interactive agent run
   * (live-computed — concurrent launches converge on the last-initiated one at the next SSE
   * invalidation), else the just-launched bridge (which also carries the sign-in REPL, whose
   * command has no session lineage).
   */
  readonly attachedCommandId = computed(() => {
    const running = newestRunningInteractiveAgent(this.commandsQuery.data(), this.workspaceId());
    if (running?.id) {
      return running.id;
    }
    const launched = this.launchedCommandId();
    if (!launched) {
      return null;
    }
    // Once the registry knows the launched command and it isn't running, stop bridging.
    const known = (this.commandsQuery.data() ?? []).find((c) => c.id === launched);
    return known && known.status !== CommandStatus.Running ? null : launched;
  });

  readonly hasRunningSession = computed(() => this.attachedCommandId() !== null);

  /** The finished embedded run the ended state refers to; null while something is attached. */
  readonly endedCommandId = computed(() =>
    this.attachedCommandId() ? null : this.lastAttachedId(),
  );

  /**
   * The workspace's last session: the newest finished command with a session lineage, its list's
   * last entry (the command's current session, per the lineage contract). Chat sessions count —
   * resuming the last chat conversation in the terminal is deliberate continuity.
   */
  readonly lastSessionId = computed(() => {
    const finished = (this.commandsQuery.data() ?? []).filter(
      (c) =>
        c.workspaceId === this.workspaceId() &&
        c.status !== CommandStatus.Running &&
        (c.agentSessions?.length ?? 0) > 0,
    );
    if (finished.length === 0) {
      return null;
    }
    const newest = finished.reduce((best, c) => (launchMillis(c) > launchMillis(best) ? c : best));
    const sessions = newest.agentSessions!;
    return sessions[sessions.length - 1]?.sessionId ?? null;
  });

  readonly launchMutation = injectMutation(() => ({
    mutationFn: ({
      resumeSessionId,
      deliverTaskPrompt,
    }: {
      resumeSessionId: string | null;
      deliverTaskPrompt: boolean;
    }) =>
      lastValueFrom(
        this.agentService.apiRepositoriesRepoIdWorkspacesWorkspaceIdAgentsPost(
          this.repoId(),
          this.workspaceId(),
          {
            scope: AgentMcpScope.Repository,
            mode: AgentLaunchMode.Interactive,
            ...(resumeSessionId ? { resumeSessionId } : {}),
            ...(deliverTaskPrompt ? { deliverTaskPrompt: true } : {}),
          },
        ),
      ),
    onSuccess: (res) => {
      const id = res.command?.id;
      if (id) {
        this.launchedCommandId.set(id);
      }
      return this.queryClient.invalidateQueries({ queryKey: ['commands'] });
    },
  }));

  readonly terminateMutation = injectMutation(() => ({
    mutationFn: (commandId: string) =>
      lastValueFrom(this.commandService.apiCommandsCommandIdTerminatePost(commandId)),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['commands'] }),
  }));

  constructor() {
    // Resolution runs once per activation, as soon as the commands registry has answered.
    effect(() => {
      if (!this.activated() || this.resolutionLatch()) {
        return;
      }
      if (this.commandsQuery.data() === undefined) {
        return;
      }
      this.resolutionLatch.set(true);
      this.resolveAndLaunch();
    });

    // Remember what we embed, so its exit can render the ended state.
    effect(() => {
      const id = this.attachedCommandId();
      if (id) {
        this.lastAttachedId.set(id);
      }
    });

    // A finished run without a session lineage was the sign-in REPL: the operator completed (or
    // aborted) OAuth, so re-run resolution — the next launch proceeds signed in. Real agent runs
    // never auto-relaunch (a crashing agent would loop).
    effect(() => {
      const endedId = this.endedCommandId();
      if (!endedId || this.handledLoginExits.has(endedId)) {
        return;
      }
      const command = (this.commandsQuery.data() ?? []).find((c) => c.id === endedId);
      if (!command || (command.agentSessions?.length ?? 0) > 0) {
        return;
      }
      this.handledLoginExits.add(endedId);
      this.launchedCommandId.set(null);
      this.lastAttachedId.set(null);
      // Replay the launch the REPL interrupted — the operator signed in to get exactly that.
      void this.launch(this.lastLaunchIntent);
    });
  }

  /**
   * The resolution order from the feature contract: attach a running interactive run, defer to a
   * live chat, launch fresh when the workspace has no session history — and otherwise idle on the
   * user's explicit choice (never auto-`--resume`: the recorded session can be gone from the
   * agent's state, and resuming a vanished id exits instantly).
   */
  private resolveAndLaunch(): void {
    if (this.attachedCommandId() || this.runningChat() || this.launchMutation.isPending()) {
      return;
    }
    if (this.lastSessionId()) {
      this.idle.set(true);
      return;
    }
    void this.launch(null);
  }

  private async launch(resumeSessionId: string | null): Promise<void> {
    this.lastLaunchIntent = resumeSessionId;
    this.idle.set(false);
    // A fresh session picks up an un-run composed draft (the agent fetches it via taskPrompt); a
    // resume continues an existing conversation, so it never re-delivers the prompt.
    let deliverTaskPrompt = false;
    if (resumeSessionId === null) {
      // Persist any pending compose-tab edit (the sync service is shared and route-scoped), then
      // refresh the draft so the un-run check reads the just-saved promptVersion — otherwise an edit
      // still inside the ~1.5s autosave debounce, or a draft GET that hadn't resolved yet, would let
      // a fresh session start without picking the prompt up.
      try {
        await this.promptDraftSync.flushNow();
      } catch {
        // A failed flush leaves the draft unpersisted; launch without delivery rather than deliver
        // stale text — the compose tab surfaces its own save error.
      }
      // Read the fresh data straight off the refetch result — the query's data() signal updates a
      // microtask later than the promise resolves, so the computed could still be stale here.
      const refetched = await this.draftQuery.refetch();
      deliverTaskPrompt = WorkspaceAgentSessionComponent.isUnrunDraft(refetched.data);
    }
    this.launchMutation.mutate({ resumeSessionId, deliverTaskPrompt });
  }

  /** The ended state's Resume — explicitly continues the workspace's last session. */
  resume(): void {
    this.launchedCommandId.set(null);
    this.lastAttachedId.set(null);
    void this.launch(this.lastSessionId());
  }

  /** The explicit fresh start — the fallback when the last session is gone or unwanted. */
  startNew(): void {
    this.launchedCommandId.set(null);
    this.lastAttachedId.set(null);
    void this.launch(null);
  }

  /** The error state's Retry — repeats the launch that failed, whatever its resume intent was. */
  retry(): void {
    void this.launch(this.lastLaunchIntent);
  }
}
