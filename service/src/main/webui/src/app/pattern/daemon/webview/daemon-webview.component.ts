import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideCrosshair, lucideGlobe, lucideRotateCcw } from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceControllerService } from '@/api/api/workspaceController.service';
import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardInputDirective } from '@/shared/components/input';
import { NewSnippet, PromptContextStore } from '@/shared/state/prompt-context.store';
import { parseAppPath, stripProxyPrefix, toProxyUrl } from './app-path';
import { createComponentMatcher } from './component-matcher';
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
  imports: [NgIcon, ZardButtonComponent, ZardInputDirective],
  template: `
    @if (webViewable().length === 0) {
      <p class="py-8 text-center text-sm text-muted-foreground">
        No web-viewable daemon is running — start one from the Daemons tab.
      </p>
    } @else if (activated()) {
      <div class="flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-md border">
        <div class="flex items-center gap-2 border-b p-2">
          <!-- The globe stays put; it swaps the rest of the bar for the URL input and back. -->
          <button
            z-button
            [zType]="urlBarOpen() ? 'default' : 'outline'"
            zSize="sm"
            type="button"
            (click)="toggleUrlBar()"
            [attr.aria-pressed]="urlBarOpen()"
            aria-label="Edit the framed app's URL"
          >
            <ng-icon name="lucideGlobe" class="size-4" />
          </button>

          @if (urlBarOpen()) {
            <input
              z-input
              class="h-8 flex-1 font-mono"
              [value]="urlValue()"
              (input)="urlValue.set($any($event.target).value)"
              (keydown.enter)="applyUrl()"
              aria-label="App URL path"
              [attr.aria-invalid]="urlError() !== null"
              [attr.aria-describedby]="urlError() !== null ? 'webview-url-error' : null"
            />
            @if (urlError(); as error) {
              <span id="webview-url-error" class="text-sm text-destructive">{{ error }}</span>
            }
            @if (urlDirty()) {
              <button
                z-button
                zType="ghost"
                zSize="sm"
                type="button"
                (click)="resetUrl()"
                aria-label="Reset URL to the frame's current location"
              >
                <ng-icon name="lucideRotateCcw" class="size-4" />
              </button>
            }
            <button
              z-button
              zType="outline"
              zSize="sm"
              type="button"
              (click)="applyUrl()"
              [zDisabled]="urlError() !== null"
              aria-label="Navigate the frame to this URL"
            >
              <ng-icon name="lucideArrowRight" class="size-4" />
            </button>
          } @else {
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
              <button
                z-button
                zType="ghost"
                zSize="sm"
                type="button"
                (click)="promptContext.clearContext()"
              >
                Clear
              </button>
            }
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
  viewProviders: [
    provideIcons({ lucideArrowRight, lucideCrosshair, lucideGlobe, lucideRotateCcw }),
  ],
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
  private readonly workspaceService = inject(WorkspaceControllerService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly promptContext = inject(PromptContextStore);

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

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

  // Fetched once per pick-mode activation (no polling): the map is only needed while picking, and
  // a map that misses a just-created component simply skips attribution until the next session.
  readonly componentMapQuery = injectQuery(() => ({
    queryKey: ['component-map', this.repoId(), this.workspaceId()],
    queryFn: () =>
      lastValueFrom(
        this.workspaceService.apiRepositoriesRepoIdWorkspacesWorkspaceIdComponentMapGet(
          this.repoId(),
          this.workspaceId(),
        ),
      ),
    enabled: this.pickMode(),
  }));

  /** URL bar (globe toggle): swaps the toolbar for an input editing the frame's app-side path. */
  readonly urlBarOpen = signal(false);
  /** The frame's app-side path when the bar opened — the reset target and the "unchanged" mark. */
  readonly urlOpenedWith = signal('/');
  readonly urlValue = signal('/');
  readonly urlDirty = computed(() => this.urlValue() !== this.urlOpenedWith());
  readonly urlError = computed(() => {
    const proxyPath = this.selected()?.proxyPath;
    if (!proxyPath || !this.urlBarOpen()) {
      return null;
    }
    const parsed = parseAppPath(this.urlValue(), proxyPath, window.location.origin);
    return 'error' in parsed ? parsed.error : null;
  });

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
    // Hand the picker the component matcher as soon as the map resolves; picks made before that
    // simply carry no attribution.
    effect(() => {
      const map = this.componentMapQuery.data();
      this.picker.setMatcher(map ? createComponentMatcher(map) : null);
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
    // the component owns the proxy knowledge: enrich the pick with the app-side route so the
    // agent sees the route the app was on, not only the qits proxy path
    const proxyPath = this.selected()?.proxyPath;
    const appPath = proxyPath ? stripProxyPrefix(pick.url, proxyPath) : null;
    this.promptContext.toggle(appPath !== null ? { ...pick, appPath } : pick);
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

  /**
   * The globe toggle. Opening seeds the input with the frame's <em>current</em> app-side path —
   * read from the framed window's live location (which, unlike `frameSrc`, tracks SPA
   * navigations). Closing discards edits without applying (the escape hatch).
   */
  toggleUrlBar() {
    if (this.urlBarOpen()) {
      this.urlBarOpen.set(false);
      return;
    }
    const entryPath = this.selected()?.daemon?.webView?.entryPath?.replace(/^\/+/, '') ?? '';
    const appPath = this.currentAppPath() ?? '/' + entryPath;
    this.urlOpenedWith.set(appPath);
    this.urlValue.set(appPath);
    this.urlBarOpen.set(true);
  }

  /** Restores the input to the path the bar opened with; the frame itself is untouched. */
  resetUrl() {
    this.urlValue.set(this.urlOpenedWith());
  }

  /**
   * Navigates the frame to the edited app-side path and closes the bar; applying an unchanged
   * path just closes it. Navigation is an in-frame `location` assignment, so the existing iframe
   * `(load)` → picker re-attach covers the document swap (pick mode and marks survive).
   */
  applyUrl() {
    const proxyPath = this.selected()?.proxyPath;
    if (!proxyPath) {
      return;
    }
    const parsed = parseAppPath(this.urlValue(), proxyPath, window.location.origin);
    if ('error' in parsed) {
      return;
    }
    if (parsed.appPath !== this.urlOpenedWith()) {
      try {
        this.frame()
          ?.nativeElement.contentWindow?.location.assign(toProxyUrl(parsed.appPath, proxyPath));
      } catch {
        // a foreign-origin frame throws here — nothing we can navigate
      }
    }
    this.urlBarOpen.set(false);
  }

  /** The frame's current app-side path, or null on a foreign-origin/unavailable frame. */
  private currentAppPath(): string | null {
    const proxyPath = this.selected()?.proxyPath;
    if (!proxyPath) {
      return null;
    }
    try {
      const href = this.frame()?.nativeElement.contentWindow?.location.href;
      return href ? stripProxyPrefix(href, proxyPath) : null;
    } catch {
      return null;
    }
  }
}
