import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { WorktreeControllerService } from '@/api/api/worktreeController.service';
import { WorktreeDto } from '@/api/model/worktreeDto';

/**
 * Smart component that renders a live `bash` running in the branch's worktree. The shell itself runs
 * server-side attached to a real PTY; this component only opens a WebSocket to it and renders the
 * stream with xterm.js. The route is keyed by branch name, so we resolve the `worktreeId` the socket
 * needs from the repository's worktree list.
 */
@Component({
  selector: 'app-web-terminal',
  imports: [],
  template: `
    @if (worktreeId(); as wid) {
      <div #host class="h-[70vh] w-full overflow-hidden rounded-lg border bg-black p-2"></div>
    } @else if (worktreesQuery.isPending()) {
      <div class="text-sm text-muted-foreground">Loading worktree…</div>
    } @else {
      <div class="text-sm text-destructive">No worktree backs this branch — nothing to run bash in.</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebTerminalComponent implements OnDestroy {
  readonly repoId = input.required<string>();
  readonly branchName = input.required<string>();
  /** The run action (ActionConfiguration id) whose executeScript the terminal spawns. */
  readonly actionId = input.required<string>();

  private readonly worktreeService = inject(WorktreeControllerService);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;
  private resizeObserver?: ResizeObserver;
  private connected = false;

  readonly worktreesQuery = injectQuery(() => ({
    queryKey: ['worktrees', this.repoId()],
    queryFn: () =>
      lastValueFrom(this.worktreeService.apiRepositoriesRepoIdWorktreesGet(this.repoId())).then(
        (r) => r.entries?.map((e) => e.worktree!).filter((w): w is WorktreeDto => !!w) ?? [],
      ),
  }));

  readonly worktreeId = computed(
    () =>
      (this.worktreesQuery.data() ?? []).find((w) => w.branch === this.branchName())?.worktreeId ??
      null,
  );

  constructor() {
    // Connect once the worktree is resolved and the host element has rendered (the `@if` only mounts
    // it after `worktreeId` is known). The `connected` guard keeps this a one-shot.
    effect(() => {
      const worktreeId = this.worktreeId();
      const el = this.host()?.nativeElement;
      if (!worktreeId || !el || this.connected) {
        return;
      }
      this.connected = true;
      this.connect(worktreeId, el);
    });
  }

  private connect(worktreeId: string, el: HTMLElement): void {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#000000' },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();
    this.term = term;
    this.fitAddon = fitAddon;

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${proto}://${window.location.host}/api/terminal/${this.repoId()}/${worktreeId}/${this.actionId()}`,
    );
    this.ws = ws;

    ws.onopen = () => {
      this.sendResize();
      term.focus();
    };
    ws.onmessage = (event) => term.write(typeof event.data === 'string' ? event.data : '');
    ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    this.resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      this.sendResize();
    });
    this.resizeObserver.observe(el);
  }

  private sendResize(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.term) {
      this.ws.send(JSON.stringify({ type: 'resize', cols: this.term.cols, rows: this.term.rows }));
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.ws?.close();
    this.term?.dispose();
  }
}
