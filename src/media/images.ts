export interface PreparedImage {
  /** The bytes to store: the original, or a downsampled re-encode of it. */
  blob: Blob;
  naturalWidth: number;
  naturalHeight: number;
  /** A tiny data URL, drawn blurred until the real image is ready. */
  placeholder?: string;
}

/**
 * Anything larger is scaled down on import. 2048px keeps an image sharp well past
 * the zoom it is usually seen at, while a phone photo's 4000px would be mostly cost.
 */
export const MAX_IMPORT_SIZE = 2048;

/** Re-encode even a modestly sized image if its file is this heavy. */
const REENCODE_ABOVE_BYTES = 4 * 1024 * 1024;

const PLACEHOLDER_SIZE = 20;

/** Retrying a failed load every frame would hammer the server; wait this long. */
const RETRY_AFTER_MS = 4000;

const cache = new Map<string, HTMLImageElement>();
const pending = new Set<string>();
const failedAt = new Map<string, number>();

/**
 * Decoded images for the renderer. Returns null the first time and starts loading;
 * `onReady` fires once, which the canvas uses to schedule a redraw. A source that
 * failed (an upload not landed yet, a network blip) is tried again a little later.
 */
export function getImage(src: string, onReady?: () => void): HTMLImageElement | null {
  const cached = cache.get(src);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  if (pending.has(src)) return null;

  const failed = failedAt.get(src);
  if (failed !== undefined && performance.now() - failed < RETRY_AFTER_MS) return null;

  pending.add(src);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    cache.set(src, image);
    pending.delete(src);
    failedAt.delete(src);
    onReady?.();
  };
  image.onerror = () => {
    pending.delete(src);
    failedAt.set(src, performance.now());
    // Ask for another frame after the pause, so the retry actually happens.
    if (onReady) setTimeout(onReady, RETRY_AFTER_MS + 50);
  };
  image.src = src;
  return null;
}

/**
 * Puts bytes already in hand into the cache under the address they were stored at,
 * so an image this tab uploaded never has to be downloaded again to be shown.
 */
export async function primeImage(src: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await decode(url);
    cache.set(src, image);
    failedAt.delete(src);
  } catch {
    // Not fatal: the renderer will fetch it like any other image.
  } finally {
    // A decoded image keeps its pixels after its URL is revoked.
    URL.revokeObjectURL(url);
  }
}

export function clearImageCache(): void {
  cache.clear();
  pending.clear();
  failedAt.clear();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image'));
    image.src = src;
  });
}

function draw(image: HTMLImageElement, width: number, height: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function placeholderOf(image: HTMLImageElement, width: number, height: number): string | undefined {
  try {
    const scale = PLACEHOLDER_SIZE / Math.max(width, height, 1);
    const canvas = draw(
      image,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
    );
    return canvas?.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

/**
 * Reads a pasted or dropped image and decides what to keep: the original when it is
 * already a sensible size, otherwise a downsampled re-encode. Also makes the blurred
 * preview other people see while the real bytes are still on their way.
 */
export async function prepareImage(blob: Blob): Promise<PreparedImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await decode(url);
    const { naturalWidth, naturalHeight } = image;
    const placeholder = placeholderOf(image, naturalWidth, naturalHeight);
    const longest = Math.max(naturalWidth, naturalHeight);

    // Vectors and animations would lose what makes them what they are.
    const keepAsIs =
      blob.type === 'image/svg+xml' ||
      blob.type === 'image/gif' ||
      (longest <= MAX_IMPORT_SIZE && blob.size <= REENCODE_ABOVE_BYTES);
    if (keepAsIs) return { blob, naturalWidth, naturalHeight, placeholder };

    const scale = Math.min(1, MAX_IMPORT_SIZE / longest);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = draw(image, width, height);
    if (!canvas) return { blob, naturalWidth, naturalHeight, placeholder };

    // PNG keeps transparency; photos and screenshots compress far better as WebP.
    const type = blob.type === 'image/png' ? 'image/png' : 'image/webp';
    let resized = await toBlob(canvas, type, 0.9);
    // A huge PNG screenshot can stay huge as PNG; WebP keeps its alpha at a fraction.
    if (resized && resized.size > REENCODE_ABOVE_BYTES && type === 'image/png') {
      resized = (await toBlob(canvas, 'image/webp', 0.9)) ?? resized;
    }
    if (!resized) return { blob, naturalWidth, naturalHeight, placeholder };
    // Re-encoding for weight alone is pointless if it did not get lighter.
    if (scale === 1 && resized.size >= blob.size) {
      return { blob, naturalWidth, naturalHeight, placeholder };
    }
    return { blob: resized, naturalWidth: width, naturalHeight: height, placeholder };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Pulls image blobs out of a paste or a file drop. */
export function imageBlobsFrom(transfer: DataTransfer | null): Blob[] {
  if (!transfer) return [];
  const blobs: Blob[] = [];

  for (const item of transfer.items ?? []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) blobs.push(file);
    }
  }
  if (blobs.length === 0) {
    for (const file of transfer.files ?? []) {
      if (file.type.startsWith('image/')) blobs.push(file);
    }
  }
  return blobs;
}

/** The zoom at which a newly placed picture exactly fills the screen's height. */
export const PICTURE_FIT_ZOOM = 0.58;

/**
 * The size a pasted, dropped or imported picture starts at: as tall as the screen
 * would be at 58% zoom, keeping its shape. Zoomed out to 58%, it fills the screen
 * top to bottom.
 */
export function screenFitImageBox(
  image: { naturalWidth: number; naturalHeight: number },
  stageHeight: number,
): { w: number; h: number } {
  const h = Math.max(1, Math.round(stageHeight / PICTURE_FIT_ZOOM));
  const ratio = image.naturalWidth / (image.naturalHeight || 1);
  return { w: Math.max(1, Math.round(h * ratio)), h };
}

/** A sensible starting size on the board: big enough to see, not overwhelming. */
export function initialImageBox(
  image: { naturalWidth: number; naturalHeight: number },
  targetLongest = 420,
): { w: number; h: number } {
  const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
  const scale = Math.min(1, targetLongest / longest);
  return {
    w: Math.max(1, Math.round(image.naturalWidth * scale)),
    h: Math.max(1, Math.round(image.naturalHeight * scale)),
  };
}
