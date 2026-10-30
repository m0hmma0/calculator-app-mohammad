import { useSyncExternalStore } from 'react';

/**
 * A wide, landscape screen: the controls are a pane down the right. The stylesheets
 * that depend on it repeat this query; this is for the few things script must decide.
 */
export const SIDE_PANE_QUERY = '(min-width: 900px) and (orientation: landscape)';

const query = () =>
  typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(SIDE_PANE_QUERY) : null;

function subscribe(onChange: () => void): () => void {
  const list = query();
  list?.addEventListener('change', onChange);
  return () => list?.removeEventListener('change', onChange);
}

export function useSidePane(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  );
}
