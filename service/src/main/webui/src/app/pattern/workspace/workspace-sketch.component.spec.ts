import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { PromptDraftSyncService } from '@/pattern/workspace/prompt-draft-sync.service';
import { MAX_HISTORY, WorkspaceSketchComponent } from './workspace-sketch.component';

/** A stand-in for the real atrament instance — records mode/color/weight and lets tests fire events. */
interface FakeAtramentInstance {
  canvas: HTMLCanvasElement;
  color: string;
  weight: number;
  mode: string;
  emit(type: string): void;
}

// Defined via vi.hoisted so it exists before the hoisted vi.mock('atrament') factory runs (a plain
// top-level class would be in its temporal dead zone → "default is not a constructor").
const { FakeAtrament } = vi.hoisted(() => {
  class FakeAtrament {
    static instances: FakeAtramentInstance[] = [];
    static destroyed = 0;

    readonly canvas: HTMLCanvasElement;
    color: string;
    weight: number;
    mode: string;
    private readonly listeners = new Map<string, (event?: unknown) => void>();

    constructor(
      canvas: HTMLCanvasElement,
      opts: { color?: string; weight?: number; mode?: string },
    ) {
      this.canvas = canvas;
      this.color = opts.color ?? '';
      this.weight = opts.weight ?? 0;
      this.mode = opts.mode ?? 'draw';
      FakeAtrament.instances.push(this);
    }
    addEventListener(type: string, cb: (event?: unknown) => void): void {
      this.listeners.set(type, cb);
    }
    removeEventListener(): void {}
    clear(): void {}
    destroy(): void {
      FakeAtrament.destroyed++;
    }
    /** Test helper: dispatch a registered event (e.g. a finished stroke). */
    emit(type: string): void {
      this.listeners.get(type)?.();
    }
  }
  return { FakeAtrament };
});

vi.mock('atrament', () => ({
  default: FakeAtrament,
  MODE_DRAW: 'draw',
  MODE_ERASE: 'erase',
  MODE_FILL: 'fill',
  MODE_DISABLED: 'disabled',
}));

/** Cache/microtask work lands on the next macrotask; flush before asserting. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkspaceSketchComponent', () => {
  const attachImage = vi.fn().mockResolvedValue(undefined);
  let snapCounter = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeAtrament.instances = [];
    FakeAtrament.destroyed = 0;
    snapCounter = 0;
    attachImage.mockResolvedValue(undefined);

    // jsdom's canvas is inert — stub the surface the component touches.
    const fakeCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      globalCompositeOperation: '',
      fillStyle: '',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
      () => `data:image/png;base64,SNAP${snapCounter++}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [WorkspaceSketchComponent],
      providers: [{ provide: PromptDraftSyncService, useValue: { attachImage } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(WorkspaceSketchComponent);
    fixture.componentRef.setInput('repoId', 'repo-1');
    fixture.componentRef.setInput('workspaceId', 'wt-1');
    fixture.detectChanges();
    return fixture;
  }

  it('initialises atrament on the host canvas with a blank-baseline undo history', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;

    expect(FakeAtrament.instances).toHaveLength(1);
    // Baseline snapshot only — nothing to undo yet.
    expect(cmp['history']()).toHaveLength(1);
    expect(cmp['canUndo']()).toBe(false);
  });

  it('toggles pen/eraser mode on the atrament instance', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];

    cmp.setMode('erase');
    expect(cmp['mode']()).toBe('erase');
    expect(inst.mode).toBe('erase');

    cmp.setMode('draw');
    expect(cmp['mode']()).toBe('draw');
    expect(inst.mode).toBe('draw');
  });

  it('sets the pen colour and switches back to draw when erasing', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];
    cmp.setMode('erase');

    cmp.setColor('#dc2626');

    expect(cmp['color']()).toBe('#dc2626');
    expect(inst.color).toBe('#dc2626');
    // Picking a colour implies drawing.
    expect(cmp['mode']()).toBe('draw');
    expect(inst.mode).toBe('draw');
  });

  it('sets the stroke weight on the atrament instance', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];

    cmp.setWeight(12);
    expect(cmp['weight']()).toBe(12);
    expect(inst.weight).toBe(12);
  });

  it('snapshots each finished stroke and steps back through them on undo', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];

    inst.emit('strokeend');
    inst.emit('strokeend');
    expect(cmp['history']()).toHaveLength(3); // baseline + two strokes
    expect(cmp['canUndo']()).toBe(true);

    cmp.undo();
    expect(cmp['history']()).toHaveLength(2);
    cmp.undo();
    expect(cmp['history']()).toHaveLength(1);
    expect(cmp['canUndo']()).toBe(false);

    // Never steps past the blank baseline.
    cmp.undo();
    expect(cmp['history']()).toHaveLength(1);
  });

  it('caps undo history without evicting the blank baseline', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];
    const baseline = cmp['history']()[0]; // the SNAP taken at init

    // Draw well past the cap.
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      inst.emit('strokeend');
    }
    const capped = cmp['history']();
    expect(capped).toHaveLength(MAX_HISTORY);
    // The baseline survives eviction (oldest STROKE is dropped, not index 0).
    expect(capped[0]).toBe(baseline);

    // Undo all the way still bottoms out at the blank baseline, not the earliest retained stroke.
    while (cmp['canUndo']()) {
      cmp.undo();
    }
    expect(cmp['history']()).toEqual([baseline]);
  });

  it('clears back to a single blank baseline', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;
    const inst = FakeAtrament.instances[0];
    inst.emit('strokeend');
    expect(cmp['history']()).toHaveLength(2);

    cmp.clearCanvas();
    expect(cmp['history']()).toHaveLength(1);
    expect(cmp['canUndo']()).toBe(false);
  });

  it('attaches the export as a sketch image and flashes confirmation', async () => {
    const fixture = await setup();
    const cmp = fixture.componentInstance;

    await cmp.attach();
    await flush();

    // The exported PNG (white-backfilled by exportSketch) is attached as a 'sketch' image.
    expect(attachImage).toHaveBeenCalledWith(expect.any(String), 'image/png', 'sketch');
    expect(cmp['attached']()).toBe(true);
    expect(cmp['attachError']()).toBe(false);
  });

  it('surfaces a failed attach instead of swallowing it', async () => {
    attachImage.mockRejectedValueOnce(new Error('413 too large'));
    const fixture = await setup();
    const cmp = fixture.componentInstance;

    await cmp.attach();
    await flush();

    expect(cmp['attachError']()).toBe(true);
    expect(cmp['attached']()).toBe(false);
  });

  it('destroys the atrament instance on teardown', async () => {
    const fixture = await setup();
    fixture.destroy();
    expect(FakeAtrament.destroyed).toBe(1);
  });
});
