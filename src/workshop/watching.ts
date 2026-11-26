import { create } from 'zustand';

/**
 * Watching a presentation full screen (asked for on 26 November): someone following a
 * presenter presses "Watch full screen", and the window shows the slide alone — no
 * controls, no side panel, nothing about the board. The browser's own full screen
 * needs a press, so it cannot start by itself. Where a page cannot go full screen (an
 * iPhone), the controls still step aside and a small Exit brings them back.
 */
interface WatchingStore {
  watching: boolean;
  /** The presentation whose prompt was waved away: not offered again until a new one. */
  dismissed: string | null;
}

export const useWatching = create<WatchingStore>(() => ({ watching: false, dismissed: null }));

const canFullScreen = () =>
  typeof document !== 'undefined' &&
  typeof document.documentElement.requestFullscreen === 'function';

export function startWatching(): void {
  document.documentElement.dataset.watching = '';
  useWatching.setState({ watching: true });
  if (canFullScreen() && !document.fullscreenElement) {
    void document.documentElement.requestFullscreen().catch(() => {});
  }
}

export function stopWatching(): void {
  delete document.documentElement.dataset.watching;
  useWatching.setState({ watching: false });
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

// Leaving full screen (Escape, the browser's own way out) ends watching too.
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && useWatching.getState().watching && canFullScreen()) {
      delete document.documentElement.dataset.watching;
      useWatching.setState({ watching: false });
    }
  });
}
