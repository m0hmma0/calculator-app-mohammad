import { useLayoutEffect, type RefObject } from 'react';

/**
 * Where each slide's notes were scrolled to, for this visit (asked for on 20
 * November): going on and back returns to the same place in each slide's notes.
 */
const positions = new Map<string, number>();

export function useNotesScroll(ref: RefObject<HTMLElement | null>, frameId: string | null): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !frameId) return;
    element.scrollTop = positions.get(frameId) ?? 0;
    const keep = () => positions.set(frameId, element.scrollTop);
    element.addEventListener('scroll', keep, { passive: true });
    return () => element.removeEventListener('scroll', keep);
  }, [ref, frameId]);
}
