import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCrosshair, lucideScan, lucideX } from '@ng-icons/lucide';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';

import { WorkspaceDaemonControllerService } from '@/api/api/workspaceDaemonController.service';
import { DaemonInstanceDto } from '@/api/model/daemonInstanceDto';
import { DaemonStatus } from '@/api/model/daemonStatus';
import { ZardButtonComponent } from '@/shared/components/button';
import { ZardDialogRef, ZardDialogService } from '@/shared/components/dialog';
import { PromptContextStore } from '@/shared/state/prompt-context.store';
import { DomPicker } from './dom-picker';

const LIVE_STATUSES: (DaemonStatus | undefined)[] = [
  DaemonStatus.Ready,
  DaemonStatus.Degraded,
  DaemonStatus.Starting,
  DaemonStatus.Restarting,
];

/**
 * The daemon web view: a floaty button (rendered only while a live web-viewable daemon exists in
 * this workspace) opening a fullscreen dialog that frames the daemon's app through the same-origin
 * `/daemon/{workspaceId}/{daemonId}/` proxy. Pick mode turns on the {@link DomPicker}; picked
 * elements land in the root {@link PromptContextStore}, where speak-to-prompt and command chats
 * pick them up — even after this dialog is closed.
 */
@Component({
  selector: 'app-daemon-webview',
  imports: [NgIcon, ZardButtonComponent],
  template: `
    @if (webViewable().length > 0) {
      <button
        z-button
        zType="secondary"
        class="fixed bottom-6 right-6 z-40 shadow-lg"
        (click)="open()"
        aria-label="Open the daemon web view"
        title="Open the daemon web view"
      >
        <ng-icon name="lucideScan" class="size-4" />
        Web view
      </button>
    }

    <ng-template #webviewTpl>
      <div class="flex h-full min-h-0 flex-col">
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
            {{ pickMode() ? 'Picking — click an element' : 'Pick element' }}
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
          <button
            z-button
            zType="ghost"
            zSize="sm"
            type="button"
            (click)="close()"
            aria-label="Close the web view"
          >
            <ng-icon name="lucideX" class="size-4" />
          </button>
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
    </ng-template>
  `,
  viewProviders: [provideIcons({ lucideScan, lucideCrosshair, lucideX })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DaemonWebviewComponent {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly daemonService = inject(WorkspaceDaemonControllerService);
  private readonly dialog = inject(ZardDialogService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly promptContext = inject(PromptContextStore);

  private readonly webviewTpl = viewChild<TemplateRef<unknown>>('webviewTpl');
  private dialogRef: ZardDialogRef<unknown> | null = null;

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
    refetchInterval: 3000,
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
   * The relative proxied path straight off the DTO — no daemon origin, no port, no composition.
   * Trusted as a resource URL: it is backend-provided registry state (never user input), and the
   * whole point is framing our own origin's /daemon/ path.
   */
  readonly frameSrc = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.selected()?.proxyPath ?? 'about:blank'),
  );

  readonly pickMode = signal(false);
  readonly pickerUnavailable = signal(false);

  private readonly picker = new DomPicker(
    (pick) => this.promptContext.add(pick),
    (available) => this.pickerUnavailable.set(!available),
  );

  open() {
    const content = this.webviewTpl();
    if (!content) {
      return;
    }
    this.pickMode.set(false);
    this.picker.setEnabled(false);
    this.selectedDaemonId.set(this.selected()?.daemon?.id ?? null);
    // Backdrop click must not close: losing the frame mid-pick is jarring; the header has an
    // explicit close. Fullscreen via twMerge'd overrides of the dialog's centering classes.
    this.dialogRef = this.dialog.create({
      zContent: content,
      zHideFooter: true,
      zMaskClosable: false,
      zCustomClasses:
        'left-0 top-0 translate-x-0 translate-y-0 h-dvh w-screen max-w-none rounded-none p-0 gap-0 grid-rows-[minmax(0,1fr)]',
    });
  }

  close() {
    this.pickMode.set(false);
    this.picker.detach();
    this.dialogRef?.close();
    this.dialogRef = null;
  }

  togglePickMode() {
    const on = !this.pickMode();
    this.pickMode.set(on);
    this.picker.setEnabled(on);
  }

  /** The re-attach hook: full reloads (F5, HMR full-reload) replace the framed document. */
  onFrameLoad(frame: HTMLIFrameElement) {
    this.picker.attach(frame);
  }
}
