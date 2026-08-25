import { create } from 'zustand';
import {
  applyPatches,
  createBoard,
  deleteElements,
  insertElements,
  replaceAll,
  transactLocal,
  type BoardDoc,
} from '@/doc/board';
import { bindBoard } from '@/doc/binding';
import { toYElement } from '@/doc/schema';
import { unionRects, type Rect } from '@/geometry';
import {
  clampZoom,
  DEFAULT_VIEWPORT,
  fitToRect,
  panByScreen,
  viewportsEqual,
  zoomAt,
  zoomAtCenter,
  type Size,
  type Viewport,
} from '@/canvas/viewport';
import { elementAABB, selectionAABB } from '@/model/bounds';
import {
  createElement,
  createElementId,
  isInteractive,
  type BoardElement,
  type ElementId,
  type ElementStyle,
  type ElementType,
  type ShapeType,
} from '@/model/element';
import { simplify, strokeBounds, toFlat, translatePoints, type InkPoint } from '@/ink/stroke';
import { scaleBoxInto } from '@/model/transform';
import { keyBetween, keysBetween, reorder, type ReorderCommand } from '@/model/zorder';
import { generateDemoElements } from '@/scene/demoElements';
import { loadViewport, saveViewport } from './viewportStorage';
import type { SnapGuide, SpacingMark } from '@/snapping/snap';

export type ContentTool = 'pen' | 'eraser' | 'laser' | 'text' | 'sticky' | 'frame';

export type Tool = 'select' | 'hand' | ShapeType | ContentTool;

export type EraserMode = 'object' | 'stroke';

export const CONTENT_TOOLS: readonly ContentTool[] = [
  'pen',
  'eraser',
  'laser',
  'text',
  'sticky',
  'frame',
];

export const SHAPE_TOOLS: readonly ShapeType[] = [
  'rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'polygon',
  'line',
  'arrow',
];

export interface RenderStatsSnapshot {
  fps: number;
  renderMs: number;
  visible: number;
}

interface BoardState {
  viewport: Viewport;
  stageSize: Size;

  tool: Tool;
  spaceHeld: boolean;
  panning: boolean;

  elements: BoardElement[];
  selection: ElementId[];

  /** Ephemeral overlay state — never persisted, redrawn every frame it changes. */
  draft: BoardElement | null;
  marquee: Rect | null;
  guides: SnapGuide[];
  spacing: SpacingMark[];
  rotationReadout: number | null;

  /** Bumped by anything that changes what the canvas should show. */
  renderVersion: number;
  snapEnabled: boolean;
  /** False until anything saved in this browser has been loaded back. */
  hydrated: boolean;
  /** Whether the browser currently has a network connection. */
  online: boolean;

  undo: () => void;
  redo: () => void;
  /** Ends the current undo step, so the next change starts a new one. */
  commitUndoStep: () => void;
  /** A patch that is a complete action in itself, rather than one frame of a drag. */
  applyDiscrete: (patches: ReadonlyMap<ElementId, Partial<BoardElement>>) => void;
  canUndo: boolean;
  canRedo: boolean;
  setUndoState: (state: { canUndo: boolean; canRedo: boolean }) => void;
  setOnline: (online: boolean) => void;

  devPanelOpen: boolean;
  shortcutsOpen: boolean;
  paletteOpen: boolean;
  contextMenu: { x: number; y: number } | null;
  stats: RenderStatsSnapshot;

  eraserMode: EraserMode;
  /** Current pen settings, kept between strokes. */
  inkWidth: number;
  inkColor: string;
  /** Element currently open in the text overlay, if any. */
  editingId: ElementId | null;

  setViewport: (viewport: Viewport) => void;
  setStageSize: (size: Size) => void;
  panBy: (dx: number, dy: number) => void;
  zoomByAt: (screenPoint: { x: number; y: number }, factor: number) => void;
  zoomStep: (direction: 1 | -1) => void;
  zoomTo100: () => void;
  zoomToFit: () => void;
  zoomToSelection: () => void;

  setTool: (tool: Tool) => void;
  setSpaceHeld: (held: boolean) => void;
  setPanning: (panning: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;

  addElement: (element: BoardElement) => void;
  patchElements: (patches: ReadonlyMap<ElementId, Partial<BoardElement>>) => void;
  replaceElements: (elements: BoardElement[]) => void;
  deleteSelection: () => void;
  duplicateSelection: (offset?: number) => void;
  nudgeSelection: (dx: number, dy: number) => void;

  selectOnly: (ids: readonly ElementId[]) => void;
  toggleSelected: (id: ElementId) => void;
  selectAll: () => void;
  clearSelection: () => void;

  setDraft: (draft: BoardElement | null) => void;
  setMarquee: (marquee: Rect | null) => void;
  setSnapFeedback: (guides: SnapGuide[], spacing: SpacingMark[]) => void;
  setRotationReadout: (degrees: number | null) => void;

  groupSelection: () => void;
  ungroupSelection: () => void;
  toggleLockSelection: () => void;
  toggleHiddenSelection: () => void;
  reorderSelection: (command: ReorderCommand) => void;
  alignSelection: (edge: 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom') => void;
  distributeSelection: (axis: 'x' | 'y') => void;
  styleSelection: (patch: Partial<ElementStyle>) => void;
  setSelectionOpacity: (opacity: number) => void;

  loadDemoElements: (count: number) => void;
  clearBoard: () => void;

  toggleDevPanel: () => void;
  toggleShortcuts: () => void;
  togglePalette: () => void;
  openContextMenu: (at: { x: number; y: number }) => void;
  closeContextMenu: () => void;
  reportStats: (stats: RenderStatsSnapshot) => void;

  setEraserMode: (mode: EraserMode) => void;
  setInk: (patch: { width?: number; color?: string }) => void;
  removeElements: (ids: readonly ElementId[]) => void;
  splitStroke: (id: ElementId, runs: readonly (readonly InkPoint[])[]) => void;
  beginEditing: (id: ElementId) => void;
  endEditing: () => void;
  setElementText: (id: ElementId, text: string) => void;
}

const ZOOM_STEP = 1.25;

/**
 * The board document is the source of truth from here on. The array in this store is
 * a derived view of it, kept up to date by the binding — which is what makes undo,
 * offline persistence and (in Phase 7) collaboration all work off the same model
 * rather than three parallel ones.
 */
export const board: BoardDoc = createBoard({
  persistenceKey: typeof indexedDB === 'undefined' ? undefined : 'sabboura-board',
});

export const useBoardStore = create<BoardState>((set, get) => {
  const bump = (patch: Partial<BoardState>) =>
    set((state) => ({ ...patch, renderVersion: state.renderVersion + 1 }));

  const selectedElements = (): BoardElement[] => {
    const { elements, selection } = get();
    const ids = new Set(selection);
    return elements.filter((element) => ids.has(element.id));
  };

  const topZ = (): string | null => get().elements.at(-1)?.z ?? null;

  return {
    viewport: typeof localStorage === 'undefined' ? DEFAULT_VIEWPORT : loadViewport(),
    stageSize: { width: 1, height: 1 },

    tool: 'select',
    spaceHeld: false,
    panning: false,

    elements: [],
    selection: [],

    draft: null,
    marquee: null,
    guides: [],
    spacing: [],
    rotationReadout: null,

    renderVersion: 0,
    snapEnabled: true,
    hydrated: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,

    canUndo: false,
    canRedo: false,

    undo: () => {
      get().endEditing();
      board.undoManager.undo();
    },

    redo: () => {
      get().endEditing();
      board.undoManager.redo();
    },

    /**
     * The capture window folds a drag's frames into one undo step, but it would just
     * as happily fold two unrelated actions together. Discrete actions close their
     * step explicitly so each is undone on its own.
     */
    commitUndoStep: () => board.undoManager.stopCapturing(),

    applyDiscrete: (patches) => {
      applyPatches(board, patches);
      board.undoManager.stopCapturing();
    },

    setUndoState: ({ canUndo, canRedo }) => set({ canUndo, canRedo }),
    setOnline: (online) => set({ online }),

    devPanelOpen: false,
    shortcutsOpen: false,
    paletteOpen: false,
    contextMenu: null,
    stats: { fps: 0, renderMs: 0, visible: 0 },

    eraserMode: 'object',
    inkWidth: 6,
    inkColor: 'var(--shape-1)',
    editingId: null,

    setViewport: (viewport) => {
      if (viewportsEqual(get().viewport, viewport)) return;
      set({ viewport });
    },

    setStageSize: (stageSize) => {
      const current = get().stageSize;
      if (current.width === stageSize.width && current.height === stageSize.height) return;
      set({ stageSize });
    },

    panBy: (dx, dy) => set({ viewport: panByScreen(get().viewport, dx, dy) }),

    zoomByAt: (screenPoint, factor) => {
      const { viewport } = get();
      set({ viewport: zoomAt(viewport, screenPoint, viewport.zoom * factor) });
    },

    zoomStep: (direction) => {
      const { viewport, stageSize } = get();
      const next = direction > 0 ? viewport.zoom * ZOOM_STEP : viewport.zoom / ZOOM_STEP;
      set({ viewport: zoomAtCenter(viewport, stageSize, next) });
    },

    zoomTo100: () => {
      const { viewport, stageSize } = get();
      set({ viewport: zoomAtCenter(viewport, stageSize, 1) });
    },

    zoomToFit: () => {
      const { elements, stageSize } = get();
      const bounds = unionRects(elements.map(elementAABB));
      if (!bounds) {
        set({ viewport: { x: -stageSize.width / 2, y: -stageSize.height / 2, zoom: 1 } });
        return;
      }
      set({ viewport: fitToRect(bounds, stageSize) });
    },

    zoomToSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) {
        get().zoomToFit();
        return;
      }
      const bounds = selectionAABB(chosen);
      if (bounds) set({ viewport: fitToRect(bounds, get().stageSize) });
    },

    setTool: (tool) => bump({ tool }),
    setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
    setPanning: (panning) => set({ panning }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),

    addElement: (element) => {
      insertElements(board, [element]);
      bump({ selection: [element.id] });
    },

    patchElements: (patches) => applyPatches(board, patches),

    replaceElements: (elements) => replaceAll(board, elements),

    deleteSelection: () => {
      const ids = new Set(get().selection);
      if (ids.size === 0) return;
      // Deleting a group takes its children with it.
      const doomed = get()
        .elements.filter(
          (element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)),
        )
        .map((element) => element.id);

      deleteElements(board, doomed);
      bump({ selection: [] });
    },

    duplicateSelection: (offset = 16) => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;

      const keys = keysBetween(topZ(), null, chosen.length);
      const copies = chosen.map((element, index) => ({
        ...element,
        id: createElementId(element.type),
        x: element.x + offset,
        y: element.y + offset,
        z: keys[index]!,
        parentId: null,
      }));

      insertElements(board, copies);
      bump({ selection: copies.map((copy) => copy.id) });
    },

    nudgeSelection: (dx, dy) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) {
        if (!isInteractive(element)) continue;
        patches.set(element.id, { x: element.x + dx, y: element.y + dy });
        for (const child of get().elements) {
          if (child.parentId === element.id) {
            patches.set(child.id, { x: child.x + dx, y: child.y + dy });
          }
        }
      }
      get().applyDiscrete(patches);
    },

    selectOnly: (ids) => bump({ selection: [...ids] }),

    toggleSelected: (id) => {
      const selection = get().selection;
      bump({
        selection: selection.includes(id)
          ? selection.filter((candidate) => candidate !== id)
          : [...selection, id],
      });
    },

    selectAll: () =>
      bump({
        selection: get()
          .elements.filter((element) => isInteractive(element) && !element.parentId)
          .map((element) => element.id),
      }),

    clearSelection: () => bump({ selection: [] }),

    setDraft: (draft) => bump({ draft }),
    setMarquee: (marquee) => bump({ marquee }),
    setSnapFeedback: (guides, spacing) => bump({ guides, spacing }),
    setRotationReadout: (rotationReadout) => bump({ rotationReadout }),

    groupSelection: () => {
      const chosen = selectedElements().filter((element) => element.type !== 'group');
      if (chosen.length < 2) return;

      const bounds = selectionAABB(chosen);
      if (!bounds) return;

      const group = createElement({ type: 'group', box: bounds, z: keyBetween(topZ(), null) });
      const ids = new Set(chosen.map((element) => element.id));

      transactLocal(board, () => {
        for (const id of ids) {
          const map = board.elements.get(id);
          if (map) map.set('parentId', group.id);
        }
        board.elements.set(group.id, toYElement(group));
      });
      bump({ selection: [group.id] });
    },

    ungroupSelection: () => {
      const groups = selectedElements().filter((element) => element.type === 'group');
      if (groups.length === 0) return;
      const groupIds = new Set(groups.map((group) => group.id));

      const freed = get()
        .elements.filter((element) => element.parentId && groupIds.has(element.parentId))
        .map((element) => element.id);

      transactLocal(board, () => {
        for (const id of freed) board.elements.get(id)?.set('parentId', null);
        for (const id of groupIds) board.elements.delete(id);
      });
      bump({ selection: freed });
    },

    toggleLockSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;
      const locking = chosen.some((element) => !element.locked);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) patches.set(element.id, { locked: locking });
      get().applyDiscrete(patches);
    },

    toggleHiddenSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;
      const hiding = chosen.some((element) => !element.hidden);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) patches.set(element.id, { hidden: hiding });
      get().applyDiscrete(patches);
    },

    reorderSelection: (command) => {
      const { elements, selection } = get();
      const keys = reorder(elements, new Set(selection), command);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const [id, z] of keys) patches.set(id, { z });
      get().applyDiscrete(patches);
    },

    alignSelection: (edge) => {
      const chosen = selectedElements();
      if (chosen.length < 2) return;
      const bounds = selectionAABB(chosen);
      if (!bounds) return;

      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) {
        const box = elementAABB(element);
        const offsetX = element.x - box.x;
        const offsetY = element.y - box.y;
        switch (edge) {
          case 'left':
            patches.set(element.id, { x: bounds.x + offsetX });
            break;
          case 'right':
            patches.set(element.id, { x: bounds.x + bounds.w - box.w + offsetX });
            break;
          case 'hcentre':
            patches.set(element.id, { x: bounds.x + (bounds.w - box.w) / 2 + offsetX });
            break;
          case 'top':
            patches.set(element.id, { y: bounds.y + offsetY });
            break;
          case 'bottom':
            patches.set(element.id, { y: bounds.y + bounds.h - box.h + offsetY });
            break;
          case 'vcentre':
            patches.set(element.id, { y: bounds.y + (bounds.h - box.h) / 2 + offsetY });
            break;
        }
      }
      get().applyDiscrete(patches);
    },

    distributeSelection: (axis) => {
      const chosen = selectedElements();
      if (chosen.length < 3) return;

      const boxes = chosen
        .map((element) => ({ element, box: elementAABB(element) }))
        .sort((a, b) => (axis === 'x' ? a.box.x - b.box.x : a.box.y - b.box.y));

      const first = boxes[0]!;
      const last = boxes.at(-1)!;
      const span =
        axis === 'x'
          ? last.box.x + last.box.w - first.box.x
          : last.box.y + last.box.h - first.box.y;
      const used = boxes.reduce(
        (total, item) => total + (axis === 'x' ? item.box.w : item.box.h),
        0,
      );
      const gap = (span - used) / (boxes.length - 1);

      const patches = new Map<ElementId, Partial<BoardElement>>();
      let cursor = axis === 'x' ? first.box.x : first.box.y;

      for (const { element, box } of boxes) {
        const offset = axis === 'x' ? element.x - box.x : element.y - box.y;
        patches.set(element.id, axis === 'x' ? { x: cursor + offset } : { y: cursor + offset });
        cursor += (axis === 'x' ? box.w : box.h) + gap;
      }
      get().applyDiscrete(patches);
    },

    styleSelection: (patch) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) {
        patches.set(element.id, { style: { ...element.style, ...patch } });
      }
      get().applyDiscrete(patches);
    },

    setSelectionOpacity: (opacity) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) patches.set(element.id, { opacity });
      get().applyDiscrete(patches);
    },

    loadDemoElements: (count) => {
      replaceAll(board, generateDemoElements(count, count));
      bump({ selection: [] });
      get().zoomToFit();
    },

    clearBoard: () => {
      replaceAll(board, []);
      bump({ selection: [], draft: null, marquee: null, viewport: DEFAULT_VIEWPORT });
    },

    toggleDevPanel: () => set((state) => ({ devPanelOpen: !state.devPanelOpen })),
    toggleShortcuts: () => set((state) => ({ shortcutsOpen: !state.shortcutsOpen })),
    togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
    openContextMenu: (at) => set({ contextMenu: at }),
    closeContextMenu: () => set({ contextMenu: null }),
    reportStats: (stats) => set({ stats }),

    setEraserMode: (eraserMode) => set({ eraserMode }),

    setInk: ({ width, color }) =>
      set((state) => ({
        inkWidth: width ?? state.inkWidth,
        inkColor: color ?? state.inkColor,
      })),

    removeElements: (ids) => {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      const selection = get().selection.filter((id) => !doomed.has(id));
      bump({
        elements: get().elements.filter(
          (element) =>
            !doomed.has(element.id) && !(element.parentId && doomed.has(element.parentId)),
        ),
        selection,
      });
    },

    /**
     * Replaces one ink element with whatever survived the eraser. No surviving run
     * means the stroke is gone; several means the eraser cut through the middle.
     */
    splitStroke: (id, runs) => {
      const { elements } = get();
      const original = elements.find((element) => element.id === id);
      if (!original) return;

      const rest = elements.filter((element) => element.id !== id);
      if (runs.length === 0) {
        bump({
          elements: rest,
          selection: get().selection.filter((candidate) => candidate !== id),
        });
        return;
      }

      const keys = keysBetween(null, original.z, runs.length);
      const pieces = runs.map((run, index) => {
        // Erasing densifies the stroke; simplifying puts it back to a sane size.
        const absolute = translatePoints(simplify(run, 0.7), original.x, original.y);
        const bounds = strokeBounds(absolute);
        return {
          ...original,
          id: createElementId('path'),
          x: bounds.x,
          y: bounds.y,
          w: bounds.w,
          h: bounds.h,
          z: keys[index]!,
          points: toFlat(translatePoints(absolute, -bounds.x, -bounds.y)),
        };
      });

      transactLocal(board, () => {
        board.elements.delete(id);
        for (const piece of pieces) board.elements.set(piece.id, toYElement(piece));
      });
      bump({ selection: get().selection.filter((candidate) => candidate !== id) });
    },

    beginEditing: (id) => bump({ editingId: id, selection: [id] }),

    endEditing: () => {
      const { editingId, elements } = get();
      if (!editingId) return;
      // An empty text box left behind by an accidental click is just litter.
      const element = elements.find((candidate) => candidate.id === editingId);
      const empty = element?.type === 'text' && (element.text ?? '').trim() === '';
      board.undoManager.stopCapturing();
      bump({
        editingId: null,
        ...(empty
          ? {
              elements: elements.filter((candidate) => candidate.id !== editingId),
              selection: [],
            }
          : {}),
      });
    },

    setElementText: (id, text) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      patches.set(id, { text });
      get().applyDiscrete(patches);
    },
  };
});

/** The tool actually in effect — holding space temporarily overrides the choice. */
export function effectiveTool(state: Pick<BoardState, 'tool' | 'spaceHeld'>): Tool {
  return state.spaceHeld ? 'hand' : state.tool;
}

/** Tools that create an element by dragging out a box. */
export type DragTool = ShapeType | 'frame';

const DRAG_TOOLS = new Set<Tool>([...SHAPE_TOOLS, 'frame']);

export function isShapeTool(tool: Tool): tool is DragTool {
  return DRAG_TOOLS.has(tool);
}

export function isContentTool(tool: Tool): tool is ContentTool {
  return (CONTENT_TOOLS as readonly Tool[]).includes(tool);
}

export function selectedIn(state: BoardState): BoardElement[] {
  const ids = new Set(state.selection);
  return state.elements.filter((element) => ids.has(element.id));
}

export function childrenOf(state: BoardState, id: ElementId): BoardElement[] {
  return state.elements.filter((element) => element.parentId === id);
}

export { clampZoom, scaleBoxInto };
export type { ElementType };

/**
 * Keeps the store's element array in step with the document. Every change — local,
 * replayed from storage, or (from Phase 7) from someone else — arrives here.
 */
bindBoard(board, (elements) => {
  useBoardStore.setState((state) => ({
    elements,
    renderVersion: state.renderVersion + 1,
    // Drop anything from the selection that no longer exists.
    selection: state.selection.filter((id) => elements.some((element) => element.id === id)),
  }));
});

void board.whenReady.then(() => {
  useBoardStore.setState({ hydrated: true });
});

const syncUndoState = () => {
  useBoardStore
    .getState()
    .setUndoState({ canUndo: board.undoManager.canUndo(), canRedo: board.undoManager.canRedo() });
};

board.undoManager.on('stack-item-added', syncUndoState);
board.undoManager.on('stack-item-popped', syncUndoState);
board.undoManager.on('stack-cleared', syncUndoState);

if (typeof window !== 'undefined') {
  const report = () => useBoardStore.getState().setOnline(navigator.onLine);
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
}

// The camera follows you back after a reload, but stays out of the shared document.
useBoardStore.subscribe((state, previous) => {
  if (state.viewport !== previous.viewport) saveViewport(state.viewport);
});
