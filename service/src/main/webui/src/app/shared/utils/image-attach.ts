/**
 * Turn an image {@link Blob} — a clipboard paste, or a Sketch-tab canvas export — into the base64
 * payload the {@code prompt-draft/attachments} endpoint accepts.
 *
 * The blob is downscaled so its long edge is at most {@link MAX_EDGE}px (Claude downscales images
 * past ~1568px anyway, and it keeps a full-resolution screenshot comfortably under the server's
 * per-image byte cap), drawn onto a white background (so a transparent PNG never reaches the agent
 * as a black rectangle), re-encoded to PNG, and stripped of its `data:…;base64,` prefix.
 */

/** The longest edge, in pixels, an attached image is scaled down to. */
export const MAX_EDGE = 1568;

export interface ImageAttachment {
  /** Bare base64 (no `data:<mime>;base64,` prefix) — the shape the attachments endpoint wants. */
  dataBase64: string;
  mimeType: 'image/png' | 'image/jpeg';
}

/**
 * The dimensions to draw an image at so its long edge is at most {@code maxEdge}, preserving aspect
 * ratio and never upscaling (scale is clamped to 1). Pure — the testable core of the downscale.
 */
export function scaledDimensions(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Strip a `data:<mime>;base64,` prefix, returning the bare base64 the API expects. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}

/**
 * Decode, downscale, white-backfill and PNG-encode {@code blob} into an {@link ImageAttachment}.
 * Uses the DOM canvas, so it only runs in a real browser (unit-tested via {@link scaledDimensions}
 * and {@link stripDataUrlPrefix}; the end-to-end path is covered by the manual acceptance walk).
 */
export async function blobToAttachment(blob: Blob): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not obtain a 2D canvas context to process the image');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { dataBase64: stripDataUrlPrefix(canvas.toDataURL('image/png')), mimeType: 'image/png' };
  } finally {
    bitmap.close();
  }
}

/**
 * The first image item on a clipboard/paste event as a {@link Blob}, or null when the paste carries
 * no image (so the caller lets text paste through). Shared by the prompt textarea and the chat input.
 */
export function imageBlobFromClipboard(data: DataTransfer | null): Blob | null {
  if (!data) {
    return null;
  }
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }
  }
  return null;
}
