import { create } from 'zustand';
import type { Transaction } from 'yjs';
import type { MarkFormats } from '@/text/marks';
import { textHeight } from '@/text/measure';
import {
  addPage,
  applyPatches,
  createBoard,
  deletePage,
  renamePage,
  deleteElements,
  insertElements,
  replaceAll,
  LOCAL_ORIGIN,
  transactAnswer,
  transactLocal,
  type BoardDoc,
} from '@/doc/board';
import { bindBoard } from '@/doc/binding';
import {
  formatYText,
  pagesOf,
  patchYElement,
  readPages,
  toYElement,
  type PageInfo,
} from '@/doc/schema';
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
  FIRST_PAGE,
  pageOf,
  isPlaceholder,
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
import { lockedForMe, mayLock } from '@/sharing/boardAccess';
import { loadViewport, saveViewport, setViewportScope } from './viewportStorage';
import type { SnapGuide, SpacingMark } from '@/snapping/snap';

export type ContentTool =
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'laser'
  | 'text'
  | 'sticky'
  | 'frame'
  | 'stamp'
  | 'placeholder';

export type Tool = 'select' | 'hand' | ShapeType | ContentTool;

export type EraserMode = 'object' | 'stroke';

export const CONTENT_TOOLS: readonly ContentTool[] = [
  'pen',
  'highlighter',
  'eraser',
  'laser',
  'text',
  'sticky',
  'frame',
  'stamp',
  'placeholder',
];

export const SHAPE_TOOLS: readonly ShapeType[] = [
  'rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'polygon',
  'cloud',
  'spike',
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
  /** The emoji the stamp tool puts down. */
  stamp: string;
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

  /** The board's pages, in order, and the one in view. */
  pages: PageInfo[];
  page: string;
  setPage: (id: string) => void;
  addPage: () => void;
  renamePage: (id: string, name: string) => void;
  deletePage: (id: string) => void;
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
  /** The highlighter's own width and colour, kept apart from the pen's. */
  markerWidth: number;
  markerColor: string;
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
  /** Picks up a stamp: the stamp tool, with this emoji on the pointer. */
  setStamp: (stamp: string) => void;
  setSpaceHeld: (held: boolean) => void;
  setPanning: (panning: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;

  addElement: (element: BoardElement) => void;
  /** Several new elements at once — a paste, a library item — selected afterwards. */
  addElements: (elements: BoardElement[]) => void;
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
  /** Locks, or unlocks, everything selected — whatever each was before. */
  setSelectionLocked: (locked: boolean) => void;
  toggleHiddenSelection: () => void;
  reorderSelection: (command: ReorderCommand) => void;
  alignSelection: (edge: 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom') => void;
  distributeSelection: (axis: 'x' | 'y') => void;
  /**
   * Lays the selection out side by side (`row`) or one under another (`column`),
   * a fixed gap apart, lined up along the top or the left — however they overlapped.
   */
  arrangeSelection: (direction: 'row' | 'column') => void;
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
  setMarker: (patch: { width?: number; color?: string }) => void;
  removeElements: (ids: readonly ElementId[]) => void;
  splitStroke: (id: ElementId, runs: readonly (readonly InkPoint[])[]) => void;
  beginEditing: (id: ElementId) => void;
  endEditing: () => void;
  setElementText: (id: ElementId, text: string) => void;
  /** Sets or clears bold, italic or underline on characters [from, to) of a text. */
  formatText: (id: ElementId, from: number, to: number, formats: MarkFormats) => void;
  /**
   * Formatting for the whole of every selected text at once — a colour for all its
   * words, say — with any change to the boxes' own style, as one step to undo.
   */
  formatSelectionText: (formats: MarkFormats, style?: Partial<ElementStyle>) => void;

  /** Puts something new in the middle of the view and selects it. */
  insertAt: (
    type: ElementType,
    size: { w: number; h: number },
    extra?: Omit<Partial<BoardElement>, 'style'> & { style?: Partial<ElementStyle> },
  ) => BoardElement | null;
  /** The table cell being typed in, if any. */
  editingCell: { id: ElementId; row: number; col: number } | null;
  beginCellEdit: (id: ElementId, row: number, col: number) => void;
  endCellEdit: () => void;
  setCell: (id: ElementId, row: number, col: number, text: string) => void;
  resizeTable: (id: ElementId, change: { rows?: number; cols?: number }) => void;
}

const ZOOM_STEP = 1.25;

/** What a viewer may still pick up: looking around, and pointing. */
/** Someone who can only look moves around the board and points: nothing to select. */
export const VIEWER_TOOLS: ReadonlySet<Tool> = new Set<Tool>(['hand', 'laser']);

/**
 * The board document is the source of truth from here on. The array in this store is
 * a derived view of it, kept up to date by the binding — which is what makes undo,
 * offline persistence and (in Phase 7) collaboration all work off the same model
 * rather than three parallel ones.
 */
const canPersist = typeof indexedDB !== 'undefined';

/**
 * Mutable, because opening a board swaps the whole document. Actions close over the
 * module binding rather than a snapshot of it, so they always write to whichever
 * board is currently open.
 */
let board: BoardDoc = createBoard({
  persistenceKey: canPersist ? 'sabboura-local' : undefined,
});

export const boardDoc = (): BoardDoc => board;

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
    stamp: '👍',
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

    pages: [{ id: FIRST_PAGE, name: 'Page 1' }],
    page: FIRST_PAGE,

    // Each page keeps its own camera; switching saves this one and restores that one.
    setPage: (id) => {
      if (id === board.currentPage) return;
      get().endEditing();
      board.currentPage = id;
      setViewportScope(openBoardId ? `${openBoardId}:${id}` : `local:${id}`);
      set({ page: id, selection: [], viewport: loadViewport() });
      binding?.refresh();
    },

    addPage: () => {
      const id = addPage(board, `Page ${get().pages.length + 1}`);
      if (id) get().setPage(id);
    },

    renamePage: (id, name) => {
      const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 60);
      if (trimmed) renamePage(board, id, trimmed);
    },

    deletePage: (id) => {
      const { pages } = get();
      if (pages.length < 2) return;
      const next = pages.find((page) => page.id !== id)!;
      if (get().page === id) get().setPage(next.id);
      deletePage(board, id);
    },

    // Someone who answers undoes their own typing: the only changes they have made.
    undo: () => {
      get().endEditing();
      if (!board.readOnly || board.answers) board.undoManager.undo();
    },

    redo: () => {
      get().endEditing();
      if (!board.readOnly || board.answers) board.undoManager.redo();
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
    markerWidth: 20,
    markerColor: '#ffe14d',
    editingId: null,

    setViewport: (viewport) => {
      if (viewportsEqual(get().viewport, viewport)) return;
      set({ viewport });
    },

    setStageSize: (stageSize) => {
      const current = get().stageSize;
      if (current.width === stageSize.width && current.height === stageSize.height) return;
      set({ stageSize });
      // A board that loaded before the screen was measured is fitted now.
      if (openFit.waitingForSize) fitOnOpen();
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

    // Someone who may only view keeps the tools that change nothing.
    setTool: (tool) => {
      if (board.readOnly && !VIEWER_TOOLS.has(tool)) return;
      // Picking up another tool puts down what was selected: drawing or erasing is
      // not done to the selection, and handles left on it only get in the way.
      const another = tool !== get().tool && tool !== 'select';
      bump(another ? { tool, selection: [] } : { tool });
    },
    setStamp: (stamp) => {
      if (board.readOnly) return;
      bump({ tool: 'stamp', stamp });
    },
    setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
    setPanning: (panning) => set({ panning }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),

    addElement: (element) => {
      insertElements(board, [element]);
      bump({ selection: [element.id] });
    },

    addElements: (elements) => {
      if (elements.length === 0) return;
      insertElements(board, elements);
      bump({
        selection: elements.filter((element) => !element.parentId).map((element) => element.id),
      });
    },

    patchElements: (patches) => applyPatches(board, patches),

    replaceElements: (elements) => replaceAll(board, elements),

    deleteSelection: () => {
      // A locked thing is not deleted by accident: unlocked first, on purpose.
      const ids = new Set(
        selectedElements()
          .filter((element) => !lockedForMe(element))
          .map((element) => element.id),
      );
      if (ids.size === 0) return;
      // Deleting a group takes its children with it.
      const doomed = get()
        .elements.filter(
          (element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)),
        )
        .map((element) => element.id);

      deleteElements(board, doomed);
      bump({ selection: get().selection.filter((id) => !ids.has(id)) });
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
        if (element.hidden || lockedForMe(element)) continue;
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
          .elements.filter((element) => !element.hidden && !element.parentId)
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
      // Only the owner locks; anyone who edits may unlock, on purpose.
      const locking = mayLock() && chosen.some((element) => !element.locked);
      if (!locking && !chosen.some((element) => element.locked)) return;
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) patches.set(element.id, { locked: locking });
      get().applyDiscrete(patches);
    },

    setSelectionLocked: (locked) => {
      if (locked && !mayLock()) return;
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) {
        if (element.locked !== locked) patches.set(element.id, { locked });
      }
      if (patches.size > 0) get().applyDiscrete(patches);
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

    arrangeSelection: (direction) => {
      const { elements } = get();
      const chosen = selectedElements();
      if (chosen.length < 2) return;
      const row = direction === 'row';
      const GAP = 24;

      // A group moves by moving everything inside it.
      const insideOf = (id: ElementId): BoardElement[] => {
        const children = elements.filter((element) => element.parentId === id);
        return children.flatMap((child) => (child.type === 'group' ? insideOf(child.id) : [child]));
      };
      const items = chosen
        .map((element) => ({ element, box: elementAABB(element) }))
        .sort((a, b) => (row ? a.box.x - b.box.x : a.box.y - b.box.y));
      const startX = Math.min(...items.map((item) => item.box.x));
      const startY = Math.min(...items.map((item) => item.box.y));

      const patches = new Map<ElementId, Partial<BoardElement>>();
      let cursor = row ? startX : startY;
      for (const { element, box } of items) {
        const dx = (row ? cursor : startX) - box.x;
        const dy = (row ? startY : cursor) - box.y;
        const moving = element.type === 'group' ? insideOf(element.id) : [element];
        for (const each of moving) patches.set(each.id, { x: each.x + dx, y: each.y + dy });
        cursor += (row ? box.w : box.h) + GAP;
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

    setMarker: ({ width, color }) =>
      set((state) => ({
        markerWidth: width ?? state.markerWidth,
        markerColor: color ?? state.markerColor,
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

      if (runs.length === 0) {
        // Erased completely: gone from the document, so gone for everyone.
        deleteElements(board, [id]);
        bump({ selection: get().selection.filter((candidate) => candidate !== id) });
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

    beginEditing: (id) => {
      if (board.readOnly) {
        // Someone who answers types in placeholders, and nowhere else.
        const element = get().elements.find((candidate) => candidate.id === id);
        if (!board.answers || !element || !isPlaceholder(element)) return;
        bump({ editingId: id, selection: [] });
        return;
      }
      bump({ editingId: id, selection: [id] });
    },

    endEditing: () => {
      const { editingId, elements } = get();
      if (!editingId) return;
      // An empty text box left behind by an accidental click is just litter — but an
      // empty placeholder is waiting for its answer, and shows its hint again.
      const element = elements.find((candidate) => candidate.id === editingId);
      const empty =
        element?.type === 'text' && !isPlaceholder(element) && (element.text ?? '').trim() === '';
      board.undoManager.stopCapturing();
      // Removed from the document, not just this view, or everyone else keeps it.
      if (empty) deleteElements(board, [editingId]);
      bump({ editingId: null, ...(empty ? { selection: [] } : {}) });
    },

    setElementText: (id, text) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      const element = get().elements.find((candidate) => candidate.id === id);
      // A text box grows to hold what is typed, so nothing spills out of reach of a click.
      const needed = element?.type === 'text' ? textHeight(element, text) : null;
      const patch =
        needed !== null && element && needed > element.h ? { text, h: needed } : { text };
      if (board.readOnly) {
        // An answer: its words and the box's height, through the one narrow door.
        const map = board.elements.get(id);
        if (map) transactAnswer(board, id, () => patchYElement(map, patch));
        board.undoManager.stopCapturing();
        return;
      }
      patches.set(id, patch);
      get().applyDiscrete(patches);
    },

    formatText: (id, from, to, formats) => {
      const map = board.elements.get(id);
      if (!map) return;
      transactAnswer(board, id, () => formatYText(map, from, to, formats));
    },

    formatSelectionText: (formats, style) => {
      const chosen = selectedElements().filter((element) => element.text !== undefined);
      if (chosen.length === 0) return;
      transactLocal(board, () => {
        for (const element of chosen) {
          const map = board.elements.get(element.id);
          if (!map) continue;
          if (style) patchYElement(map, { style: { ...element.style, ...style } });
          formatYText(map, 0, element.text!.length, formats);
        }
      });
      board.undoManager.stopCapturing();
    },

    insertAt: (type, size, extra = {}) => {
      if (board.readOnly) return null;
      const { viewport, stageSize } = get();
      const centre = {
        x: viewport.x + stageSize.width / (2 * viewport.zoom),
        y: viewport.y + stageSize.height / (2 * viewport.zoom),
      };
      const base = createElement({
        type,
        box: { x: centre.x - size.w / 2, y: centre.y - size.h / 2, w: size.w, h: size.h },
        z: keyBetween(topZ(), null),
      });
      const element: BoardElement = { ...base, ...extra, style: { ...base.style, ...extra.style } };
      get().setTool('select');
      get().addElement(element);
      return element;
    },

    editingCell: null,

    beginCellEdit: (id, row, col) => {
      if (board.readOnly) return;
      get().endEditing();
      bump({ editingCell: { id, row, col }, selection: [id] });
    },

    endCellEdit: () => {
      if (!get().editingCell) return;
      board.undoManager.stopCapturing();
      bump({ editingCell: null });
    },

    // Only the one cell is written, so a neighbour's typing elsewhere is untouched.
    setCell: (id, row, col, text) => {
      const table = get().elements.find((element) => element.id === id)?.table;
      if (!table) return;
      applyPatches(
        board,
        new Map([[id, { table: { ...table, cells: { [`${row},${col}`]: text } } }]]),
      );
    },

    resizeTable: (id, change) => {
      const element = get().elements.find((candidate) => candidate.id === id);
      const table = element?.table;
      if (!element || !table) return;
      const rows = Math.max(1, Math.min(50, change.rows ?? table.rows));
      const cols = Math.max(1, Math.min(20, change.cols ?? table.cols));
      // Rows and columns keep their size; the table grows or shrinks around them.
      const patch: Partial<BoardElement> = {
        table: { rows, cols, cells: {} },
        h: (element.h / table.rows) * rows,
        w: (element.w / table.cols) * cols,
      };
      get().applyDiscrete(new Map([[id, patch]]));
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
 * Connects a document to the store: element changes flow in, undo availability is
 * reported, and anything previously attached is released. Called once at startup and
 * again each time a different board is opened.
 */
let binding: ReturnType<typeof bindBoard> | null = null;

/** The server-side board being edited, or null for the signed-out local board. */
let openBoardId: string | null = null;

export function currentBoardId(): string | null {
  return openBoardId;
}

/**
 * Switches the open board between editable and read-only — when it opens, and again
 * if the owner changes this person's access while they are on it.
 */
export function setBoardReadOnly(readOnly: boolean, answers = false): void {
  board.answers = readOnly && answers;
  if (board.readOnly === readOnly) return;
  board.readOnly = readOnly;
  const state = useBoardStore.getState();
  if (readOnly) {
    state.endEditing();
    useBoardStore.setState({
      tool: VIEWER_TOOLS.has(state.tool) ? state.tool : 'hand',
      draft: null,
      selection: [],
    });
  } else if (state.tool === 'hand') {
    // Able to edit after all (a board opens read-only until its role is known): back
    // to selecting, which is where an editor starts.
    useBoardStore.setState({ tool: 'select' });
  }
  useBoardStore.setState((current) => ({ renderVersion: current.renderVersion + 1 }));
}

const attachListeners = new Set<(doc: BoardDoc) => void>();

/**
 * Lets shared board state outside the element map — the timer, votes — follow
 * whichever board is open, without this store having to know about it.
 */
export function onDocumentAttached(listener: (doc: BoardDoc) => void): () => void {
  attachListeners.add(listener);
  listener(board);
  return () => attachListeners.delete(listener);
}

function attachDocument(doc: BoardDoc): void {
  binding?.destroy();
  stopWatchingWork?.();

  // Once the person has started working on the board, a copy arriving later (the
  // room's, a moment after opening) leaves their view where it is.
  const onWork = (transaction: Transaction) => {
    if (transaction.origin === LOCAL_ORIGIN && transaction.changed.size > 0) openFit.from = null;
  };
  doc.doc.on('afterTransaction', onWork);
  stopWatchingWork = () => doc.doc.off('afterTransaction', onWork);

  // The binding sees every page; the store, and so everything drawn and picked, only
  // the one in view.
  binding = bindBoard(doc, (all) => {
    const elements = all.filter((element) => pageOf(element) === doc.currentPage);
    useBoardStore.setState((state) => ({
      elements,
      renderVersion: state.renderVersion + 1,
      // Drop anything from the selection that no longer exists.
      selection: state.selection.filter((id) => elements.some((element) => element.id === id)),
    }));
  });

  // The page list is shared; if the page in view is deleted by someone, move off it.
  const syncPages = () => {
    const pages = readPages(doc.doc);
    useBoardStore.setState({ pages });
    if (!pages.some((page) => page.id === doc.currentPage)) {
      useBoardStore.getState().setPage(pages[0]!.id);
    }
  };
  pagesOf(doc.doc).observe(syncPages);
  syncPages();

  const syncUndoState = () =>
    useBoardStore
      .getState()
      .setUndoState({ canUndo: doc.undoManager.canUndo(), canRedo: doc.undoManager.canRedo() });

  doc.undoManager.on('stack-item-added', syncUndoState);
  doc.undoManager.on('stack-item-popped', syncUndoState);
  doc.undoManager.on('stack-cleared', syncUndoState);
  syncUndoState();

  for (const listener of attachListeners) listener(doc);

  useBoardStore.setState({ hydrated: false });
  void doc.whenReady.then(() => {
    useBoardStore.setState({ hydrated: true });
    if (doc === board) fitOnOpen();
  });
}

/**
 * A board opens showing everything on it — from the dashboard, from a link, or on a
 * reload. What this browser has stored arrives first, and on a board with a room
 * the room's copy a moment later, so the view is fitted to each in turn — unless the
 * person has already moved it themselves, is following someone, or has started
 * working on the board.
 */
let stopWatchingWork: (() => void) | null = null;

const openFit: { from: Viewport | null; waitingForSize: boolean } = {
  from: null,
  waitingForSize: false,
};

/** Called when a board opens: the camera it opened with is not yet the person's own. */
function expectFitOnOpen(): void {
  openFit.from = useBoardStore.getState().viewport;
  openFit.waitingForSize = false;
}

/** Fits the view to everything on the board, if it has anything and nobody has moved. */
export function fitOnOpen(): void {
  const state = useBoardStore.getState();
  if (openFit.from === null || state.viewport !== openFit.from) return;
  if (state.elements.length === 0) return;
  if (state.stageSize.width < 2 || state.stageSize.height < 2) {
    openFit.waitingForSize = true;
    return;
  }
  openFit.waitingForSize = false;
  state.zoomToFit();
  openFit.from = useBoardStore.getState().viewport;
}

attachDocument(board);
expectFitOnOpen();

/**
 * Swaps in the document for a different board. The previous one is detached and
 * destroyed, so its IndexedDB handle and observers do not linger.
 */
export function openBoardDocument(boardId: string | null): BoardDoc {
  const key = boardId ? `sabboura-board-${boardId}` : 'sabboura-local';
  const previous = board;
  openBoardId = boardId;

  board = createBoard({ persistenceKey: canPersist ? key : undefined });
  setViewportScope(boardId ? `${boardId}:${FIRST_PAGE}` : null);
  attachDocument(board);
  useBoardStore.setState({
    selection: [],
    editingId: null,
    draft: null,
    marquee: null,
    page: FIRST_PAGE,
    viewport: loadViewport(),
  });
  expectFitOnOpen();

  previous.destroy();
  return board;
}

if (typeof window !== 'undefined') {
  const report = () => useBoardStore.getState().setOnline(navigator.onLine);
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
}

// The camera follows you back after a reload, but stays out of the shared document.
useBoardStore.subscribe((state, previous) => {
  if (state.viewport !== previous.viewport) saveViewport(state.viewport);
});
