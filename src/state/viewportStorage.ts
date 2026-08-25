import { clampZoom, DEFAULT_VIEWPORT, type Viewport } from '@/canvas/viewport';

const KEY = 'sabboura:viewport';
const SAVE_DELAY_MS = 250;

/**
 * The camera is deliberately *not* in the shared document. Where someone is looking
 * is personal: in Phase 7 two people on the same board each need their own view, and
 * putting the viewport in the CRDT would drag them around after each other.
 */
export function loadViewport(): Viewport {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return DEFAULT_VIEWPORT;

    const parsed = JSON.parse(stored) as Partial<Viewport>;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.zoom !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y)
    ) {
      return DEFAULT_VIEWPORT;
    }
    return { x: parsed.x, y: parsed.y, zoom: clampZoom(parsed.zoom) };
  } catch {
    // A private window can refuse storage entirely; that is not worth failing over.
    return DEFAULT_VIEWPORT;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Viewport | null = null;

function write(viewport: Viewport): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(viewport));
  } catch {
    // Ignore — losing the camera position is a far smaller problem than throwing.
  }
}

/** Debounced, because panning would otherwise write on every animation frame. */
export function saveViewport(viewport: Viewport): void {
  pending = viewport;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (pending) write(pending);
    pending = null;
  }, SAVE_DELAY_MS);
}

/** Writes immediately — the debounce must not swallow the last change on unload. */
export function flushViewport(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) write(pending);
  pending = null;
}

if (typeof window !== 'undefined') {
  // pagehide fires for a reload, a close and a back-navigation alike.
  window.addEventListener('pagehide', flushViewport);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushViewport();
  });
}
