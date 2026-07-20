import { describe, expect, it } from 'vitest';

import { MAX_EDGE, scaledDimensions, stripDataUrlPrefix } from './image-attach';

describe('scaledDimensions', () => {
  it('leaves an image whose long edge is within the cap untouched', () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(MAX_EDGE, 100)).toEqual({ width: MAX_EDGE, height: 100 });
  });

  it('scales a too-wide image so its long edge equals the cap, preserving aspect ratio', () => {
    // 3136×1568 → long edge 3136 halves to 1568, the short edge halves too.
    expect(scaledDimensions(3136, 1568)).toEqual({ width: MAX_EDGE, height: 784 });
  });

  it('scales by the long edge when height dominates', () => {
    expect(scaledDimensions(784, 3136)).toEqual({ width: 392, height: MAX_EDGE });
  });

  it('never produces a zero dimension for an extreme aspect ratio', () => {
    const { width, height } = scaledDimensions(10000, 1);
    expect(width).toBe(MAX_EDGE);
    expect(height).toBe(1);
  });

  it('never upscales a small image', () => {
    expect(scaledDimensions(64, 48)).toEqual({ width: 64, height: 48 });
  });
});

describe('stripDataUrlPrefix', () => {
  it('drops the data-URL prefix, leaving bare base64', () => {
    expect(stripDataUrlPrefix('data:image/png;base64,AAAB')).toBe('AAAB');
  });

  it('returns the input unchanged when there is no prefix', () => {
    expect(stripDataUrlPrefix('AAAB')).toBe('AAAB');
  });
});
