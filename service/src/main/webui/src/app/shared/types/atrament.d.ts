/**
 * Minimal ambient types for `atrament` (the Sketch-tab drawing library) — it ships no `.d.ts`.
 * Only the surface the {@code WorkspaceSketchComponent} uses is declared; extend as needed.
 */
declare module 'atrament' {
  /** Atrament's drawing modes; we only use draw + erase. */
  export const MODE_DRAW: 'draw';
  export const MODE_ERASE: 'erase';
  export const MODE_FILL: 'fill';
  export const MODE_DISABLED: 'disabled';

  export type AtramentMode = 'draw' | 'erase' | 'fill' | 'disabled';

  export interface AtramentOptions {
    width?: number;
    height?: number;
    color?: string;
    weight?: number;
    mode?: AtramentMode;
    smoothing?: number;
    adaptiveStroke?: boolean;
  }

  /** The events atrament dispatches on itself (subset). */
  export type AtramentEvent =
    | 'strokestart'
    | 'strokeend'
    | 'dirty'
    | 'clean'
    | 'pointerdown'
    | 'pointerup';

  export default class Atrament {
    constructor(canvas: HTMLCanvasElement, options?: AtramentOptions);
    readonly canvas: HTMLCanvasElement;
    /** CSS color string; setting it changes the pen stroke color. */
    color: string;
    /** Base stroke weight in px. */
    weight: number;
    /** `'draw'` | `'erase'` | `'fill'` | `'disabled'`. */
    mode: AtramentMode;
    readonly dirty: boolean;
    addEventListener(type: AtramentEvent, handler: (event?: unknown) => void): void;
    removeEventListener(type: AtramentEvent, handler: (event?: unknown) => void): void;
    /** Wipe the canvas (dispatches `clean`). */
    clear(): void;
    /** Clear + detach every pointer listener. */
    destroy(): void;
  }
}
