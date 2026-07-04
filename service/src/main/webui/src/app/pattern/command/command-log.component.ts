import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { lastValueFrom } from 'rxjs';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { CommandControllerService } from '@/api/api/commandController.service';
import { CommandLogLineDto } from '@/api/model/commandLogLineDto';
import { LogChannel } from '@/api/model/logChannel';

/** Output lines this far apart (ms) get a gap marker, to surface long pauses in the run. */
const GAP_THRESHOLD_MS = 2000;

/**
 * Read-only audit log of a finished command: the captured per-line history rendered into a
 * non-interactive xterm so ANSI colours survive. STDIN lines (what the human typed) are marked
 * distinctly from OUTPUT, and long pauses between lines are shown as gap markers.
 */
@Component({
  selector: 'app-command-log',
  imports: [],
  template: `
    @if (logQuery.isPending()) {
      <div class="text-sm text-muted-foreground">Loading log…</div>
    } @else if (logQuery.isError()) {
      <div class="text-sm text-destructive">Failed to load log</div>
    } @else if ((logQuery.data() ?? []).length === 0) {
      <div class="text-sm text-muted-foreground">This command produced no captured output.</div>
    } @else {
      <div #host class="h-[70vh] w-full overflow-hidden rounded-lg border bg-black p-2"></div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandLogComponent implements OnDestroy {
  readonly commandId = input.required<string>();
  /**
   * Optional anchor: the log-line sequence range a daemon event referenced. The anchored lines
   * render inverse-video and the view scrolls to the first of them.
   */
  readonly highlightFrom = input<number | null>(null);
  readonly highlightTo = input<number | null>(null);

  private readonly commandService = inject(CommandControllerService);
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private rendered = false;

  readonly logQuery = injectQuery(() => ({
    queryKey: ['command-log', this.commandId()],
    queryFn: () =>
      lastValueFrom(this.commandService.apiCommandsCommandIdLogGet(this.commandId())).then(
        (r) => r.lines ?? [],
      ),
  }));

  constructor() {
    // Render once the lines have loaded and the host element exists (it only mounts when non-empty).
    effect(() => {
      const lines = this.logQuery.data();
      const el = this.host()?.nativeElement;
      if (!lines || !el || this.rendered) {
        return;
      }
      this.rendered = true;
      this.render(lines, el);
    });
  }

  private render(lines: CommandLogLineDto[], el: HTMLElement): void {
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
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

    const from = this.highlightFrom();
    const to = this.highlightTo() ?? from;

    let previous: number | null = null;
    let row = 0;
    let scrollRow: number | null = null;
    const out: string[] = [];
    for (const line of lines) {
      const at = line.timestamp ? Date.parse(line.timestamp) : null;
      if (previous !== null && at !== null && at - previous > GAP_THRESHOLD_MS) {
        out.push(`\x1b[90m──── ${this.formatGap(at - previous)} ────\x1b[0m\r\n`);
        row++;
      }
      if (at !== null) {
        previous = at;
      }
      const anchored =
        from !== null && line.sequence != null && line.sequence >= from && line.sequence <= to!;
      if (anchored && scrollRow === null) {
        scrollRow = row;
      }
      const content = line.content ?? '';
      if (line.channel === LogChannel.Stdin) {
        // Cyan, with a marker, so typed input is distinct from program output.
        out.push(`\x1b[36m❯ ${content}\x1b[0m\r\n`);
      } else if (anchored) {
        // Inverse video marks the anchored evidence a daemon event pointed at.
        out.push(`\x1b[7m${content}\x1b[27m\r\n`);
      } else {
        out.push(`${content}\r\n`);
      }
      row++;
    }
    term.write(out.join(''), () => {
      if (scrollRow !== null) {
        // Rows are pre-wrap estimates; close enough to land the anchor on screen.
        term.scrollToLine(Math.max(0, scrollRow - 3));
      }
    });
  }

  private formatGap(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
  }

  ngOnDestroy(): void {
    this.term?.dispose();
  }
}
