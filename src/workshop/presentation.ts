import { create } from 'zustand';
import { SIDE_PANE_QUERY } from '@/ui/layout';
import { clearLaser } from '@/laser/laserTrail';
import { centerOn, fitToRect, type Size, type Viewport } from '@/canvas/viewport';
import type { Rect } from '@/geometry';
import { usePresence } from '@/collab/presence';
import { selectionAABB } from '@/model/bounds';
import type { BoardElement } from '@/model/element';
import { keysBetween } from '@/model/zorder';
import { setViewportGuard, useBoardStore } from '@/state/boardStore';
import { closeAudienceWindow, openAudienceWindow } from './audience';
import { closeRemote } from './remote';

/** Margin around a frame in presentation, in screen pixels. */
export const PRESENT_PADDING = 24;

/** Room kept either side of the slide in presenter view for its big arrows. */
const ARROW_ROOM = 56;

interface PresentationStore {
  presenting: boolean;
  /** The frame on screen, by id, so frames added or moved mid-talk do not skip it. */
  frame: string | null;
  /** Presenter view: the audience window is open (`src/workshop/audience.ts`). */
  audience: boolean;
  /** When it opened, for the presenter's clock. */
  audienceSince: number | null;
  /** When presenting began (epoch ms), for a remote control's clock. */
  startedAt: number | null;
  /** Videos and sounds the audience window could not play, so heard here instead. */
  heardHere: readonly string[];
  /** Presenter view's notes, in pixels: the slide fits beside them. */
  notesInset: number;
  /** Where they are: along the bottom, or (a phone on its side) down the right. */
  notesSide: 'bottom' | 'right';
  /** A transition is playing over the board (`SlideTransition`); videos wait under it. */
  transitioning: boolean;
}

export const usePresentation = create<PresentationStore>(() => ({
  presenting: false,
  frame: null,
  audience: false,
  audienceSince: null,
  startedAt: null,
  heardHere: [],
  notesInset: 0,
  notesSide: 'bottom',
  transitioning: false,
}));

/**
 * Frames in column order: top to bottom down a column, then the next column to the
 * right, top to bottom again. Frames whose left edges are within half the narrower
 * one's width share a column, so a hand-placed column that is a few pixels off still
 * reads top to bottom. Frames side by side in a single row are each a column of
 * their own, so a row still reads left to right.
 */
function columnOrder(frames: readonly BoardElement[]): BoardElement[] {
  const byLeft = [...frames].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns: BoardElement[][] = [];
  for (const frame of byLeft) {
    const column = columns.at(-1);
    const anchor = column?.[0];
    if (column && anchor && frame.x - anchor.x < Math.min(anchor.w, frame.w) / 2) {
      column.push(frame);
    } else {
      columns.push([frame]);
    }
  }
  return columns.flatMap((column) => column.sort((a, b) => a.y - b.y));
}

/**
 * The page's frames in presentation order: the ones given a number first, by it;
 * then any never numbered — every frame on an older board, and new ones — in column
 * order. Two with the same key (a duplicated frame) also fall back to column order.
 */
export function framesInOrder(elements: readonly BoardElement[]): BoardElement[] {
  const reading = columnOrder(
    elements.filter((element) => element.type === 'frame' && !element.hidden),
  );
  const place = new Map(reading.map((frame, index) => [frame.id, index]));
  const numbered = reading
    .filter((frame) => frame.slide)
    .sort((a, b) =>
      a.slide! < b.slide! ? -1 : a.slide! > b.slide! ? 1 : place.get(a.id)! - place.get(b.id)!,
    );
  return [...numbered, ...reading.filter((frame) => !frame.slide)];
}

/** Each frame's number, from 1, as the presentation will show them. */
export function frameNumbers(elements: readonly BoardElement[]): Map<string, number> {
  return new Map(framesInOrder(elements).map((frame, index) => [frame.id, index + 1]));
}

/**
 * Keys that put frames in exactly this order. Every frame is given one, so the order
 * holds from then on, wherever anyone moves them.
 */
export function slidePatches(order: readonly string[]): Map<string, Partial<BoardElement>> {
  const keys = keysBetween(null, null, order.length);
  return new Map(order.map((id, index) => [id, { slide: keys[index]! }]));
}

/** Whether any frame on the page has a number of its own, rather than its place. */
export function hasFrameNumbers(elements: readonly BoardElement[]): boolean {
  return elements.some((element) => element.type === 'frame' && element.slide);
}

/**
 * Takes every frame's number away, so all of them are numbered by where they are —
 * down each column, then the next — and keep following that as they move, until
 * someone chooses a number again. One step to undo.
 */
export function numberFramesAutomatically(): void {
  const store = useBoardStore.getState();
  const patches = new Map<string, Partial<BoardElement>>();
  for (const element of store.elements) {
    if (element.type === 'frame' && element.slide) patches.set(element.id, { slide: null });
  }
  if (patches.size > 0) store.applyDiscrete(patches);
}

/**
 * The frame presenting would start from: a selected frame (the first in order, if
 * several are), or else the frame holding what is selected — the one the middle of
 * the selection sits in. Null when neither, and presenting starts from the first.
 */
export function selectedFrame(
  elements: readonly BoardElement[],
  selection: readonly string[],
): BoardElement | null {
  if (selection.length === 0) return null;
  const frames = framesInOrder(elements);
  const chosen = frames.find((frame) => selection.includes(frame.id));
  if (chosen) return chosen;
  const box = selectionAABB(elements.filter((element) => selection.includes(element.id)));
  if (!box) return null;
  const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  return (
    frames.find(
      (frame) =>
        middle.x >= frame.x &&
        middle.x <= frame.x + frame.w &&
        middle.y >= frame.y &&
        middle.y <= frame.y + frame.h,
    ) ?? null
  );
}

/** Gives a frame a new number (from 1); the others close up around it. */
export function renumberFrame(frameId: string, number: number): void {
  const store = useBoardStore.getState();
  const order = framesInOrder(store.elements).map((frame) => frame.id);
  const from = order.indexOf(frameId);
  if (from === -1) return;
  order.splice(from, 1);
  order.splice(Math.min(order.length, Math.max(0, number - 1)), 0, frameId);
  store.applyDiscrete(slidePatches(order));
}

/**
 * Room kept along the bottom for the slide controls, where they sit over the board
 * (a tall screen or a phone; on a wide one they are in the pane), so they never cover
 * the slide.
 */
const BAR_ROOM = 64;

/**
 * The part of the stage the slide is shown in: all of it, less presenter view's notes
 * and the slide controls along the bottom.
 */
function slideArea(): Size {
  const { stageSize } = useBoardStore.getState();
  const { audience, notesInset, notesSide } = usePresentation.getState();
  const inset = audience ? notesInset : 0;
  const bar =
    typeof window !== 'undefined' && !window.matchMedia?.(SIDE_PANE_QUERY).matches ? BAR_ROOM : 0;
  return notesSide === 'right'
    ? { width: stageSize.width - inset, height: stageSize.height - bar }
    : { width: stageSize.width, height: stageSize.height - inset - bar };
}

/** The view that shows the whole frame: the slide at its own size. */
function fittedView(frame: Rect): Viewport {
  const size = slideArea();
  if (!usePresentation.getState().audience) return fitToRect(frame, size, PRESENT_PADDING);
  // In presenter view the big previous and next buttons sit either side: the slide
  // fits between them, centred.
  const room = { width: Math.max(1, size.width - 2 * ARROW_ROOM), height: size.height };
  const { zoom } = fitToRect(frame, room, PRESENT_PADDING);
  return centerOn({ x: 0, y: 0, zoom }, size, {
    x: frame.x + frame.w / 2,
    y: frame.y + frame.h / 2,
  });
}

/**
 * Where a view may go while a slide is on show (asked for on 20 November): never
 * smaller than the slide's own size, which shows it whole and centred; zoomed in, only
 * as far as the slide's edges — a side narrower than the screen stays centred.
 */
export function keepOnSlide(view: Viewport, frame: Rect, fitted: Viewport, size: Size): Viewport {
  if (view.zoom <= fitted.zoom * 1.0001) return fitted;
  const axis = (start: number, length: number, from: number, visible: number) =>
    length <= visible
      ? start + length / 2 - visible / 2
      : Math.min(start + length - visible, Math.max(start, from));
  return {
    zoom: view.zoom,
    x: axis(frame.x, frame.w, view.x, size.width / view.zoom),
    y: axis(frame.y, frame.h, view.y, size.height / view.zoom),
  };
}

/** The frame on show, while this window presents. */
function presentedFrame(): BoardElement | null {
  const { presenting, frame } = usePresentation.getState();
  if (!presenting || !frame) return null;
  return useBoardStore.getState().elements.find((element) => element.id === frame) ?? null;
}

const guardSlide = (view: Viewport): Viewport => {
  const frame = presentedFrame();
  return frame ? keepOnSlide(view, frame, fittedView(frame), slideArea()) : view;
};

/** True when the slide on show is at its own size, not zoomed into. */
function atSlideSize(): boolean {
  const frame = presentedFrame();
  if (!frame) return false;
  return useBoardStore.getState().viewport.zoom <= fittedView(frame).zoom * 1.0001;
}

/** A drag at least this far across, and mostly across, is a swipe to the next slide. */
const SWIPE_PX = 50;

/**
 * A drag with the hand while presenting, when it ends: at the slide's own size, a
 * swipe left goes on and a swipe right goes back. True if it moved the slides.
 */
export function swipeSlides(dx: number, dy: number): boolean {
  if (!atSlideSize()) return false;
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return false;
  stepPresentation(dx < 0 ? 1 : -1);
  return true;
}

function show(frameId: string | null) {
  const store = useBoardStore.getState();
  const frame = store.elements.find((element) => element.id === frameId);
  // A new slide starts clean: no laser left from the last one (the room and the
  // audience window hear the trail is gone, so every screen clears).
  if ((frame?.id ?? null) !== usePresentation.getState().frame) clearLaser();
  usePresentation.setState({ frame: frame?.id ?? null });
  usePresence.setState({ present: frame ? { frame: frame.id } : null });
  if (!frame) return;
  store.setViewport(fittedView(frame));
}

let stopWatching: (() => void) | null = null;

/**
 * Starts presenting: from the selected frame, or the one holding what is selected
 * (`selectedFrame`), otherwise from the first frame.
 */
export function startPresentation(): boolean {
  const { elements, selection } = useBoardStore.getState();
  const frames = framesInOrder(elements);
  if (frames.length === 0) return false;
  const first = selectedFrame(elements, selection) ?? frames[0]!;
  document.documentElement.dataset.presenting = '';
  // Presenting is spotlighting: everyone else on the board follows along.
  usePresence.setState({ spotlight: true, following: null });
  useBoardStore.getState().clearSelection();
  usePresentation.setState({ presenting: true, startedAt: Date.now() });
  setViewportGuard(guardSlide);
  show(first.id);
  // The chrome goes away, so the stage grows; the frame is refitted to the new size.
  const stopStage = useBoardStore.subscribe((state, previous) => {
    if (state.stageSize !== previous.stageSize) show(usePresentation.getState().frame);
  });
  // Presenter view opening or closing, or its notes growing, changes the room too.
  const stopNotes = usePresentation.subscribe((state, previous) => {
    if (
      state.audience !== previous.audience ||
      state.notesInset !== previous.notesInset ||
      state.notesSide !== previous.notesSide
    ) {
      show(state.frame);
    }
  });
  stopWatching = () => {
    stopStage();
    stopNotes();
  };
  return true;
}

export function stopPresentation(): void {
  // The audience window goes with the presentation, as a slide show's does.
  closeAudienceWindow();
  closeRemote();
  stopWatching?.();
  stopWatching = null;
  setViewportGuard(null);
  delete document.documentElement.dataset.presenting;
  usePresentation.setState({ presenting: false, frame: null, startedAt: null });
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

/**
 * Presenter view: presents (if not already) and opens the audience window, which
 * shows only the slides. False when there are no frames or the browser blocked the
 * window. Must run inside the click that asked for it.
 */
export function startPresenterView(): 'started' | 'no-frames' | 'blocked' {
  const wasPresenting = usePresentation.getState().presenting;
  if (!wasPresenting && framesInOrder(useBoardStore.getState().elements).length === 0) {
    return 'no-frames';
  }
  // The window first, while the click still counts: presenting changes the page.
  if (!openAudienceWindow()) return 'blocked';
  if (!wasPresenting) startPresentation();
  return 'started';
}
