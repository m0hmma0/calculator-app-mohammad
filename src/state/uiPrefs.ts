import { create } from 'zustand';

/**
 * Personal choices about what is on screen. Like the camera, they belong to this
 * person in this browser, not to the board: hiding your minimap hides nobody else's.
 */
interface UiPrefs {
  minimap: boolean;
  /** The list of everything on the board, in the inspector. */
  layers: boolean;
  /** Timer lengths used most recently, newest first, in seconds. */
  recentTimers: number[];
}

const KEY = 'sabboura:ui';
const MAX_RECENT_TIMERS = 4;

function load(): UiPrefs {
  const fallback: UiPrefs = { minimap: false, layers: false, recentTimers: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<UiPrefs>;
    return {
      minimap: stored.minimap === true,
      layers: stored.layers === true,
      recentTimers: Array.isArray(stored.recentTimers)
        ? stored.recentTimers
            .filter((seconds) => Number.isFinite(seconds) && seconds > 0)
            .slice(0, MAX_RECENT_TIMERS)
        : [],
    };
  } catch {
    return fallback;
  }
}

export const useUiPrefs = create<UiPrefs>(() => load());

useUiPrefs.subscribe((state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A private window may refuse; the choice still holds for this visit.
  }
});

export const toggleMinimap = () => useUiPrefs.setState((state) => ({ minimap: !state.minimap }));
export const toggleLayers = () => useUiPrefs.setState((state) => ({ layers: !state.layers }));

/** Remembers a timer length, so the next one can be started with one click. */
export function rememberTimer(seconds: number): void {
  useUiPrefs.setState((state) => ({
    recentTimers: [seconds, ...state.recentTimers.filter((each) => each !== seconds)].slice(
      0,
      MAX_RECENT_TIMERS,
    ),
  }));
}

/** 90 → "1:30"; 300 → "5:00". */
export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
