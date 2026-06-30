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

    let previous: number | null = null;
    const out: string[] = [];
    for (const line of lines) {
      const at = line.timestamp ? Date.parse(line.timestamp) : null;
      if (previous !== null && at !== null && at - previous > GAP_THRESHOLD_MS) {
        out.push(`\x1b[90m──── ${this.formatGap(at - previous)} ────\x1b[0m\r\n`);
      }
      if (at !== null) {
        previous = at;
      }
      const content = line.content ?? '';
      if (line.channel === LogChannel.Stdin) {
        // Cyan, with a marker, so typed input is distinct from program output.
        out.push(`\x1b[36m❯ ${content}\x1b[0m\r\n`);
      } else {
        out.push(`${content}\r\n`);
      }
    }
    term.write(out.join(''));
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
