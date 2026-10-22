import { create } from 'zustand';
import { fitToRect } from '@/canvas/viewport';
import { usePresence } from '@/collab/presence';
import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';

/** Margin around a frame in presentation, in screen pixels. */
export const PRESENT_PADDING = 24;

interface PresentationStore {
  presenting: boolean;
  /** The frame on screen, by id, so frames added or moved mid-talk do not skip it. */
  frame: string | null;
}

export const usePresentation = create<PresentationStore>(() => ({
  presenting: false,
  frame: null,
}));

/**
 * The page's frames in reading order: top to bottom in rows, left to right within a
 * row. Frames whose tops are within half the shorter one's height share a row, so a
 * hand-placed row that is a few pixels off still reads left to right.
 */
export function framesInOrder(elements: readonly BoardElement[]): BoardElement[] {
  const frames = elements.filter((element) => element.type === 'frame' && !element.hidden);
  const byTop = [...frames].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: BoardElement[][] = [];
  for (const frame of byTop) {
    const row = rows.at(-1);
    const anchor = row?.[0];
    if (row && anchor && frame.y - anchor.y < Math.min(anchor.h, frame.h) / 2) row.push(frame);
    else rows.push([frame]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

function show(frameId: string | null) {
  const store = useBoardStore.getState();
  const frame = store.elements.find((element) => element.id === frameId);
  usePresentation.setState({ frame: frame?.id ?? null });
  usePresence.setState({ present: frame ? { frame: frame.id } : null });
  if (frame) store.setViewport(fitToRect(frame, store.stageSize, PRESENT_PADDING));
}

let stopWatching: (() => void) | null = null;

export function startPresentation(): boolean {
  const frames = framesInOrder(useBoardStore.getState().elements);
  if (frames.length === 0) return false;
  document.documentElement.dataset.presenting = '';
  // Presenting is spotlighting: everyone else on the board follows along.
  usePresence.setState({ spotlight: true, following: null });
  useBoardStore.getState().clearSelection();
  usePresentation.setState({ presenting: true });
  show(frames[0]!.id);
  // The chrome goes away, so the stage grows; the frame is refitted to the new size.
  stopWatching = useBoardStore.subscribe((state, previous) => {
    if (state.stageSize !== previous.stageSize) show(usePresentation.getState().frame);
  });
  return true;
}

export function stopPresentation(): void {
  stopWatching?.();
  stopWatching = null;
  delete document.documentElement.dataset.presenting;
  usePresentation.setState({ presenting: false, frame: null });
  usePresence.setState({ spotlight: false, present: null });
}

/** Moves by `step` frames; past either end, stays put. */
export function stepPresentation(step: number): void {
  const frames = framesInOrder(useBoardStore.getState().elements);
  if (frames.length === 0) return stopPresentation();
  const current = frames.findIndex((frame) => frame.id === usePresentation.getState().frame);
  const next = Math.min(frames.length - 1, Math.max(0, (current === -1 ? 0 : current) + step));
  show(frames[next]!.id);
}
