import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCrosshair } from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { ZardButtonComponent } from '@/shared/components/button';
import { NewSnippet, PromptContextStore } from '@/shared/state/prompt-context.store';
import { DomPicker, PickOptions } from './dom-picker';

const LIVE_STATUSES: (DaemonStatus | undefined)[] = [
  DaemonStatus.Ready,
  DaemonStatus.Degraded,
  DaemonStatus.Starting,
  DaemonStatus.Restarting,
];

/**
 * The workspace's Web view tab: frames the daemon's app through the same-origin
 * `/daemon/{workspaceId}/{daemonId}/` proxy. Always present — without a live web-viewable daemon
 * it renders an empty state instead of a dead frame. The iframe mounts on the tab's first
 * activation (the page passes `activated`) and then stays mounted while a live daemon exists, so
 * the framed app doesn't reload on every tab switch. Pick mode turns on the {@link DomPicker};
 * picked elements land in the root {@link PromptContextStore}, where the Chat tab's
 * speak-to-prompt and command chats pick them up. A plain pick is one-shot — it drops pick mode —
 * while shift-click (or a touch long press) keeps the mode on for multi-pick.
 */
@Component({
  selector: 'app-daemon-webview',
  imports: [NgIcon, ZardButtonComponent],
  template: `
    @if (webViewable().length === 0) {
      <p class="py-8 text-center text-sm text-muted-foreground">
        No web-viewable daemon is running — start one from the Daemons tab.
      </p>
    } @else if (activated()) {
      <div class="flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-md border">
        <div class="flex items-center gap-2 border-b p-2">
          @if (webViewable().length > 1) {
            <select
              class="h-8 rounded-md border bg-transparent px-2 text-sm"
              [value]="selectedDaemonId()"
              (change)="selectedDaemonId.set($any($event.target).value)"
              aria-label="Framed daemon"
            >
              @for (instance of webViewable(); track instance.daemon?.id) {
                <option [value]="instance.daemon?.id">{{ instance.daemon?.name }}</option>
              }
            </select>
          } @else {
            <span class="text-sm font-medium">{{ selected()?.daemon?.name }}</span>
          }

          <button
            z-button
            [zType]="pickMode() ? 'default' : 'outline'"
            zSize="sm"
            type="button"
            (click)="togglePickMode()"
            [attr.aria-pressed]="pickMode()"
          >
            <ng-icon name="lucideCrosshair" class="size-4" />
            {{ pickMode() ? 'Picking — click an element (⇧ keeps picking)' : 'Pick element' }}
          </button>
          @if (pickerUnavailable()) {
            <span class="text-sm text-destructive">picker unavailable on external pages</span>
          }

          <span class="flex-1"></span>

          @if (promptContext.count() > 0) {
            <span class="text-sm text-muted-foreground">
              {{ promptContext.count() }} picked
            </span>
            <button z-button zType="ghost" zSize="sm" type="button" (click)="promptContext.clear()">
              Clear
            </button>
          }
        </div>

        <!-- Same-origin through the proxy; deliberately no sandbox attribute — with
             allow-same-origin it is neutralized anyway, without it contentDocument (the picker)
             and the app's own storage break. -->
        <iframe
          #frame
          class="min-h-0 w-full flex-1 border-0"
          [src]="frameSrc()"
          (load)="onFrameLoad(frame)"
          title="Daemon web view"
        ></iframe>
      </div>
    }
  `,
  viewProviders: [provideIcons({ lucideCrosshair })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonWebviewComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();
  /**
   * Set (once) by the page when the Web view tab is first selected. Hidden tab panels stay
   * mounted, so without this gate the iframe would load the framed app eagerly on page load even
   * if the tab is never opened.
   */
  readonly activated = input(false);

  private readonly daemonService = inject(WorkspaceDaemonControllerService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly promptContext = inject(PromptContextStore);

  // Same key AND result shape as WorkspaceDaemonsComponent's daemonsQuery — they share the cache
  // entry, so the queryFn must stay identical.
  readonly daemonsQuery = injectQuery(() => ({
    queryKey: ['workspace-daemons', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.daemonService.apiRepositoriesRepoIdWorkspacesWorkspaceIdDaemonsGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ).then(
        (r) =>
          r.entries?.map((e) => e.instance).filter((i): i is DaemonInstanceDto => !!i) ?? [],
      ),
  }));

  readonly webViewable = computed(() =>
    (this.daemonsQuery.data() ?? []).filter(
      (i) => !!i.proxyPath && LIVE_STATUSES.includes(i.status),
    ),
  );

  readonly selectedDaemonId = signal<string | null>(null);
  readonly selected = computed(() => {
    const candidates = this.webViewable();
    return candidates.find((i) => i.daemon?.id === this.selectedDaemonId()) ?? candidates[0] ?? null;
  });
  /**
   * The relative proxied path off the DTO plus the definition's entry path — no daemon origin, no
   * port. proxyPath is trailing-slashed and entryPath is stored slash-less (both validated
   * backend-side), so the join is a plain concatenation. Trusted as a resource URL: it is
   * backend-provided registry/definition state (never user input), and the whole point is framing
   * our own origin's /daemon/ path.
   */
  readonly frameSrc = computed(() => {
    const selected = this.selected();
    if (!selected?.proxyPath) {
      return this.sanitizer.bypassSecurityTrustResourceUrl('about:blank');
    }
    const entryPath = selected.daemon?.webView?.entryPath?.replace(/^\/+/, '') ?? '';
    return this.sanitizer.bypassSecurityTrustResourceUrl(selected.proxyPath + entryPath);
  });

  readonly pickMode = signal(false);
  readonly pickerUnavailable = signal(false);

  private readonly picker = new DomPicker(
    (pick, options) => this.onPicked(pick, options),
    (available) => this.pickerUnavailable.set(!available),
  );

  constructor() {
    // When the last live daemon goes away the iframe unmounts with the empty state — drop pick
    // mode and the picker's stale document with it.
    effect(() => {
      if (this.webViewable().length === 0) {
        this.pickMode.set(false);
        this.picker.detach();
      }
    });
    // Keep the picker's already-picked marks in sync with the store: new picks gain their
    // border immediately, removed/cleared ones lose it.
    effect(() => {
      this.picker.setPicked(
        this.promptContext.snippets().map((s) => ({ selector: s.selector, url: s.url })),
      );
    });
  }

  togglePickMode() {
    this.setPickMode(!this.pickMode());
  }

  /**
   * A pick is one-shot: it lands in the prompt context and drops pick mode, so the framed app is
   * usable again immediately. The multi-pick gestures (shift-click, touch long press) set
   * `keepPicking` and leave the mode on. Picking an already picked element unpicks it (toggle).
   */
  onPicked(pick: NewSnippet, options: PickOptions) {
    this.promptContext.toggle(pick);
    if (!options.keepPicking) {
      this.setPickMode(false);
    }
  }

  private setPickMode(on: boolean) {
    this.pickMode.set(on);
    this.picker.setEnabled(on);
  }

  /** The re-attach hook: full reloads (F5, HMR full-reload) replace the framed document. */
  onFrameLoad(frame: HTMLIFrameElement) {
    this.picker.attach(frame);
  }
}
