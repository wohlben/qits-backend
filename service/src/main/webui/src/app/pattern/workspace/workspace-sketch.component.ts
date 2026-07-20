import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import Atrament, { MODE_DRAW, MODE_ERASE } from 'atrament';

import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { ZardButtonComponent } from '@/shared/components/button';
import { scaledDimensions, stripDataUrlPrefix } from '@/shared/utils/image-attach';

/** A selectable pen colour: the CSS value atrament draws with, plus an a11y label. */
interface SketchColor {
  value: string;
  label: string;
}

/** A selectable stroke weight (atrament `weight`, px), plus an a11y label. */
interface SketchWeight {
  value: number;
  label: string;
}

const COLORS: readonly SketchColor[] = [
  { value: '#000000', label: 'Black' },
  { value: '#dc2626', label: 'Red' },
  { value: '#2563eb', label: 'Blue' },
];

const WEIGHTS: readonly SketchWeight[] = [
  { value: 2, label: 'Thin' },
  { value: 5, label: 'Medium' },
  { value: 12, label: 'Thick' },
];

/** The canvas' fixed logical drawing size — a wide "napkin", scaled to fit via CSS. */
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 640;

/** Keep at most this many undo snapshots so a long doodling session can't grow memory unbounded. */
export const MAX_HISTORY = 30;

/**
 * The workspace's Sketch tab: a minimal drawing surface (pen/eraser, a few widths and colours, undo,
 * clear) whose "Attach to prompt" button hands the drawing to the coding agent. It exports the canvas
 * and pushes it into the workspace's prompt draft as a `'sketch'` image attachment via
 * {@link PromptDraftSyncService.attachImage} — the exact same path a pasted screenshot takes, so the
 * agent fetches it over the {@code taskPrompt} MCP tool in every launch shape.
 *
 * <p>The canvas is white-backfilled and the export runs through {@link blobToAttachment} (white
 * background + downscale), so an erased region (atrament's eraser punches transparent holes) never
 * reaches the agent as a black rectangle. The panel stays mounted while its tab is hidden (the tab
 * group keeps hidden tabs mounted), so a half-finished drawing survives tab switches for free.
 *
 * <p>Wraps the vanilla-JS {@code atrament} library the same way {@code WebTerminalComponent} wraps
 * xterm.js: grab the host {@code <canvas>} via {@code viewChild} and initialise once in a one-shot
 * {@code effect} guard, tearing the instance down in {@code ngOnDestroy}.
 */
@Component({
  selector: 'app-workspace-sketch',
  imports: [ZardButtonComponent],
  template: `
    <div class="flex flex-col gap-3">
      <p class="text-xs text-muted-foreground">
        Sketch a rough drawing — an arrow, a layout, "move this here" — then attach it to the prompt.
        The coding agent sees it alongside your text.
      </p>

      <div class="flex flex-wrap items-center gap-3" role="toolbar" aria-label="Sketch tools">
        <!-- Pen / eraser -->
        <div class="flex items-center gap-1" role="group" aria-label="Tool">
          <button
            z-button
            zSize="sm"
            [zType]="mode() === 'draw' ? 'default' : 'outline'"
            type="button"
            [attr.aria-pressed]="mode() === 'draw'"
            (click)="setMode('draw')"
          >
            Pen
          </button>
          <button
            z-button
            zSize="sm"
            [zType]="mode() === 'erase' ? 'default' : 'outline'"
            type="button"
            [attr.aria-pressed]="mode() === 'erase'"
            (click)="setMode('erase')"
          >
            Eraser
          </button>
        </div>

        <!-- Colours -->
        <div class="flex items-center gap-1" role="group" aria-label="Colour">
          @for (c of colors; track c.value) {
            <button
              type="button"
              class="size-6 rounded-full border border-border transition-[box-shadow]"
              [style.background-color]="c.value"
              [class.ring-2]="color() === c.value"
              [class.ring-ring]="color() === c.value"
              [class.ring-offset-1]="color() === c.value"
              [attr.aria-label]="c.label"
              [attr.aria-pressed]="color() === c.value"
              (click)="setColor(c.value)"
            ></button>
          }
        </div>

        <!-- Widths -->
        <div class="flex items-center gap-1" role="group" aria-label="Stroke width">
          @for (w of weights; track w.value) {
            <button
              z-button
              zSize="sm"
              [zType]="weight() === w.value ? 'default' : 'outline'"
              type="button"
              [attr.aria-pressed]="weight() === w.value"
              (click)="setWeight(w.value)"
            >
              {{ w.label }}
            </button>
          }
        </div>

        <div class="flex items-center gap-1">
          <button
            z-button
            zSize="sm"
            zType="outline"
            type="button"
            [zDisabled]="!canUndo()"
            (click)="undo()"
          >
            Undo
          </button>
          <button z-button zSize="sm" zType="outline" type="button" (click)="clearCanvas()">
            Clear
          </button>
        </div>
      </div>

      <canvas
        #canvas
        class="w-full max-w-full touch-none rounded-md border bg-white shadow-sm"
        [style.aspect-ratio]="aspectRatio"
        aria-label="Sketch canvas — draw with the mouse or a stylus"
      ></canvas>

      <div class="flex items-center gap-3">
        <button
          z-button
          type="button"
          [zLoading]="attaching()"
          [zDisabled]="attaching()"
          (click)="attach()"
        >
          Attach to prompt
        </button>
        @if (attached()) {
          <span class="text-sm text-muted-foreground" role="status">Attached ✓</span>
        }
        @if (attachError()) {
          <span class="text-sm text-destructive" role="status">
            Couldn't attach the sketch — it may exceed the size limit. Try clearing some detail.
          </span>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceSketchComponent implements OnDestroy {
  readonly repoId = input.required<string>();
  readonly workspaceId = input.required<string>();

  private readonly promptDraftSync = inject(PromptDraftSyncService);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly colors = COLORS;
  protected readonly weights = WEIGHTS;
  protected readonly aspectRatio = `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`;

  protected readonly mode = signal<'draw' | 'erase'>('draw');
  protected readonly color = signal<string>(COLORS[0].value);
  protected readonly weight = signal<number>(WEIGHTS[1].value);

  /** A stack of `toDataURL` snapshots, oldest (blank) first; undo pops back to the previous one. */
  private readonly history = signal<string[]>([]);
  /** More than the blank baseline exists to step back to. */
  protected readonly canUndo = () => this.history().length > 1;

  protected readonly attaching = signal(false);
  protected readonly attached = signal(false);
  protected readonly attachError = signal(false);

  private atrament?: Atrament;
  private ready = false;
  private attachedTimer?: ReturnType<typeof setTimeout>;
  /** Bumped per repaint request; a deferred Image.onload only paints if it is still the latest. */
  private repaintSeq = 0;

  constructor() {
    // Initialise atrament once the host canvas has rendered. The `ready` guard keeps it one-shot,
    // mirroring WebTerminalComponent's `connected` latch.
    effect(() => {
      const el = this.canvasRef()?.nativeElement;
      if (!el || this.ready) {
        return;
      }
      this.ready = true;
      this.init(el);
    });
  }

  private init(el: HTMLCanvasElement): void {
    // No 2D context ⇒ nothing to draw (a non-canvas environment, e.g. jsdom in tests). Bail before
    // constructing atrament, which dereferences the context in its constructor and would throw.
    if (!el.getContext('2d')) {
      return;
    }
    // Construct atrament first: it sets `canvas.width/height`, which resets the pixel buffer — so any
    // white fill must happen AFTER construction or it would be wiped. It also grabs the 2D context we
    // reuse for white-fill/undo repaint.
    const atrament = new Atrament(el, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      color: this.color(),
      weight: this.weight(),
      mode: MODE_DRAW,
    });
    this.atrament = atrament;
    this.paintWhite();
    // Baseline snapshot so undo has a blank state to return to.
    this.history.set([el.toDataURL('image/png')]);
    // Snapshot after every finished stroke; that's the state undo steps back through.
    atrament.addEventListener('strokeend', () => this.pushSnapshot());
  }

  /** The shared 2D context (atrament draws on the same one). */
  private context(): CanvasRenderingContext2D | null {
    return this.canvasRef()?.nativeElement.getContext('2d') ?? null;
  }

  /** Paint the whole canvas opaque white, resetting any transform/composite the eraser left set. */
  private paintWhite(): void {
    const el = this.canvasRef()?.nativeElement;
    const ctx = this.context();
    if (!el || !ctx) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.restore();
  }

  private pushSnapshot(): void {
    const el = this.canvasRef()?.nativeElement;
    if (!el) {
      return;
    }
    this.history.update((h) => {
      const next = [...h, el.toDataURL('image/png')];
      // Cap growth by evicting the OLDEST stroke (index 1), never the blank baseline at index 0 —
      // undo must always be able to step back to a clean canvas. A plain slice(-MAX_HISTORY) would
      // drop the baseline first and strand the earliest ink (only Clear could remove it).
      if (next.length > MAX_HISTORY) {
        next.splice(1, next.length - MAX_HISTORY);
      }
      return next;
    });
  }

  setMode(mode: 'draw' | 'erase'): void {
    this.mode.set(mode);
    if (this.atrament) {
      this.atrament.mode = mode === 'erase' ? MODE_ERASE : MODE_DRAW;
    }
  }

  setColor(value: string): void {
    this.color.set(value);
    // Picking a colour implies drawing, not erasing.
    if (this.mode() === 'erase') {
      this.setMode('draw');
    }
    if (this.atrament) {
      this.atrament.color = value;
    }
  }

  setWeight(value: number): void {
    this.weight.set(value);
    if (this.atrament) {
      this.atrament.weight = value;
    }
  }

  /** Step back to the previous snapshot (never past the blank baseline). */
  undo(): void {
    const h = this.history();
    if (h.length <= 1) {
      return;
    }
    const next = h.slice(0, -1);
    this.repaint(next[next.length - 1]);
    this.history.set(next);
  }

  /** Wipe to a fresh white canvas and reset the undo history to that blank baseline. */
  clearCanvas(): void {
    const el = this.canvasRef()?.nativeElement;
    if (!el) {
      return;
    }
    this.paintWhite();
    this.history.set([el.toDataURL('image/png')]);
  }

  /** Repaint the canvas from a snapshot data URL (used by undo); leaves atrament's mode untouched. */
  private repaint(dataUrl: string): void {
    const el = this.canvasRef()?.nativeElement;
    const ctx = this.context();
    if (!el || !ctx) {
      return;
    }
    // Image decode is async: two quick undos would each schedule an onload, and their completion
    // order for different data URLs is not guaranteed to match request order. Stamp a sequence so a
    // stale (superseded) repaint bails — the last-requested snapshot always wins, matching `history`.
    const seq = ++this.repaintSeq;
    const img = new Image();
    img.onload = () => {
      if (seq !== this.repaintSeq) {
        return;
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.drawImage(img, 0, 0, el.width, el.height);
      ctx.restore();
    };
    img.src = dataUrl;
  }

  /**
   * Export the drawing and attach it to the prompt draft as a `'sketch'` image, then the same {@code
   * attachImage} path a pasted screenshot uses. The export (see {@link exportSketch}) composites the
   * canvas onto a white background — so an erased region (a transparent hole atrament's eraser
   * punches) never reaches the agent as a black rectangle — in a single PNG encode. A failed attach
   * (oversize/encode) is surfaced rather than swallowed.
   */
  async attach(): Promise<void> {
    const el = this.canvasRef()?.nativeElement;
    if (!el || this.attaching()) {
      return;
    }
    this.attaching.set(true);
    this.attachError.set(false);
    try {
      await this.promptDraftSync.attachImage(exportSketch(el), 'image/png', 'sketch');
      this.flashAttached();
    } catch {
      this.attachError.set(true);
    } finally {
      this.attaching.set(false);
    }
  }

  private flashAttached(): void {
    this.attached.set(true);
    clearTimeout(this.attachedTimer);
    this.attachedTimer = setTimeout(() => this.attached.set(false), 2000);
  }

  ngOnDestroy(): void {
    clearTimeout(this.attachedTimer);
    this.atrament?.destroy();
  }
}

/**
 * Export the sketch as bare (prefix-free) base64 PNG on a white background, in a single encode.
 * Draws the live canvas onto a white-filled export canvas (downscaled with the shared
 * {@link scaledDimensions} so an oversized future canvas stays under the attachment cap) — the same
 * white-backfill + downscale result {@code blobToAttachment} gives the paste path, without its
 * intermediate blob decode/re-encode round trip.
 */
function exportSketch(canvas: HTMLCanvasElement): string {
  const { width, height } = scaledDimensions(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('Could not obtain a 2D canvas context to export the sketch');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0, width, height);
  return stripDataUrlPrefix(out.toDataURL('image/png'));
}
