export interface ImportedImage {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}

/** Anything larger is scaled down on import — a phone photo is 4000px of nothing. */
export const MAX_IMPORT_SIZE = 1600;

const cache = new Map<string, HTMLImageElement>();
const pending = new Set<string>();

/**
 * Decoded images for the renderer. Returns null the first time and starts loading;
 * `onReady` fires once, which the canvas uses to schedule a redraw.
 */
export function getImage(src: string, onReady?: () => void): HTMLImageElement | null {
  const cached = cache.get(src);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  if (pending.has(src)) return null;

  pending.add(src);
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    cache.set(src, image);
    pending.delete(src);
    onReady?.();
  };
  image.onerror = () => {
    pending.delete(src);
  };
  image.src = src;
  return null;
}

export function clearImageCache(): void {
  cache.clear();
  pending.clear();
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(blob);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image'));
    image.src = src;
  });
}

/**
 * Reads a pasted or dropped image, scaling it down if it is enormous. Phase 6 sends
 * the bytes to R2 instead of keeping a data URL, but the sizing decision stays here.
 */
export async function importImage(blob: Blob): Promise<ImportedImage> {
  const original = await readAsDataUrl(blob);
  const image = await decode(original);
  const { naturalWidth, naturalHeight } = image;
  const longest = Math.max(naturalWidth, naturalHeight);

  if (longest <= MAX_IMPORT_SIZE || blob.type === 'image/svg+xml') {
    return { src: original, naturalWidth, naturalHeight };
  }

  const scale = MAX_IMPORT_SIZE / longest;
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { src: original, naturalWidth, naturalHeight };

  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  // PNG keeps transparency; screenshots and photos compress far better as WebP.
  const type = blob.type === 'image/png' ? 'image/png' : 'image/webp';
  const resized = canvas.toDataURL(type, 0.92);
  return { src: resized, naturalWidth: width, naturalHeight: height };
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

/** A sensible starting size on the board: big enough to see, not overwhelming. */
export function initialImageBox(
  image: ImportedImage,
  targetLongest = 420,
): { w: number; h: number } {
  const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
  const scale = Math.min(1, targetLongest / longest);
  return {
    w: Math.max(1, Math.round(image.naturalWidth * scale)),
    h: Math.max(1, Math.round(image.naturalHeight * scale)),
  };
}
