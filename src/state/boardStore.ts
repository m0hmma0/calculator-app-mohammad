import { create } from 'zustand';
import type { Transaction } from 'yjs';
import type { MarkFormats } from '@/text/marks';
import { fitted, textHeight } from '@/text/measure';
import {
  applyPatches,
  createBoard,
  dropExtraPages,
  deleteElements,
  insertElements,
  replaceAll,
  LOCAL_ORIGIN,
  transactAnswer,
  transactLocal,
  type BoardDoc,
} from '@/doc/board';
import { bindBoard } from '@/doc/binding';
import { HISTORY_ORIGIN, trackHistory, type History } from '@/doc/history';
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
  arrangementOf,
  ARRANGE_GAP_STEP,
  DEFAULT_ARRANGE_GAP,
  orderedForArrangement,
  type ArrangeDirection,
} from '@/model/arrangement';
import { groupRoot, layoutBox, overlappingFrame, withGroupMembers } from '@/model/frameGroups';
import { copiesOf } from '@/model/copies';
import { fitWidthPatch, frameForFitWidth } from '@/model/fitWidth';
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
import { lockedForMe, mayLockForOthers } from '@/sharing/boardAccess';
import { loadViewport, saveViewport, setViewportScope } from './viewportStorage';
import { useWorkspace } from './workspaceStore';
import type { SnapGuide, SpacingMark } from '@/snapping/snap';
import { isAudienceWindow } from '@/workshop/audienceMode';

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

/**
 * What the eraser takes: whole pen and highlighter strokes and nothing else (the
 * default), the whole object under it, or the part of a stroke it passes over.
 */
export type EraserMode = 'drawings' | 'object' | 'stroke';

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
  /** The picture being cropped, if any: its box is the crop, its whole shown faded. */
  croppingId: ElementId | null;
  beginCrop: (id: ElementId) => void;
  endCrop: () => void;

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
  /**
   * Copies what is selected and selects the copy: directly below it, lined up, by
   * default; in place for an Alt-drag, which then carries the copy away.
   */
  duplicateSelection: (placement?: 'below' | 'inPlace') => void;
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
  groupDroppedItems: (ids: readonly ElementId[], moving: ReadonlySet<ElementId>) => void;
  ungroupSelection: () => void;
  toggleLockSelection: () => void;
  /** Locks, or unlocks, everything selected — whatever each was before. */
  /** Locks what is selected — for everyone, or for everyone but the owner — or unlocks it. */
  setSelectionLocked: (locked: boolean, mode?: 'all' | 'others') => void;
  toggleHiddenSelection: () => void;
  reorderSelection: (command: ReorderCommand) => void;
  fitSelectionWidth: () => void;
  alignSelection: (edge: 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom') => void;
  distributeSelection: (axis: 'x' | 'y') => void;
  /**
   * Lays the selection out side by side (`row`) or one under another (`column`),
   * a fixed gap apart, lined up along the top or the left — however they overlapped.
   */
  arrangeSelection: (direction: ArrangeDirection, gap?: number) => void;
  changeArrangementGap: (step: -1 | 1) => void;
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

/** What a change must touch before a box that follows its text needs measuring again. */
const FIT_KEYS = ['w', 'h', 'text', 'style', 'placeholder', 'autoHeight'] as const;

/**
 * Changes about to be written, with the height worked out for every text box that
 * follows its text. A move (x and y only, every frame of a drag) is passed through
 * without looking anything up.
 */
function fitHeights(
  elements: readonly BoardElement[],
  patches: ReadonlyMap<ElementId, Partial<BoardElement>>,
): ReadonlyMap<ElementId, Partial<BoardElement>> {
  const touched = [...patches].filter(([, patch]) => FIT_KEYS.some((key) => key in patch));
  if (touched.length === 0) return patches;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const out = new Map(patches);
  for (const [id, patch] of touched) {
    const element = byId.get(id);
    if (element?.type === 'text') out.set(id, fitted(element, patch));
  }
  return out;
}

const ZOOM_STEP = 1.25;
/** How far below the original a duplicate lands, in board units. */
export const DUPLICATE_GAP = 16;

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
  // The audience window keeps nothing: its board comes from the presenter's window.
  persistenceKey: canPersist && !isAudienceWindow() ? 'sabboura-local' : undefined,
});

export const boardDoc = (): BoardDoc => board;

export function selectFitWidthFrame({ elements, selection }: BoardState): BoardElement | null {
  if (selection.length !== 1 || board.readOnly) return null;
  const element = elements.find((item) => item.id === selection[0]);
  return element && !lockedForMe(element) ? frameForFitWidth(element, elements) : null;
}

export function selectArrangement(state: Pick<BoardState, 'elements' | 'selection'>) {
  if (state.selection.length < 2 || board.readOnly) return null;
  const selection = new Set(state.selection);
  if (withGroupMembers(state.elements, selection).some(lockedForMe)) return null;
  const items = state.elements.filter((element) => selection.has(element.id) && !element.hidden);
  return arrangementOf(items.map((element) => layoutBox(element, state.elements)));
}

export function canUngroup(element: BoardElement, elements: readonly BoardElement[]): boolean {
  return (
    !lockedForMe(element) &&
    (element.type === 'group' ||
      (element.type === 'frame' && elements.some((item) => item.parentId === element.id)))
  );
}

export const useBoardStore = create<BoardState>((set, get) => {
  const bump = (patch: Partial<BoardState>) =>
    set((state) => ({ ...patch, renderVersion: state.renderVersion + 1 }));

  const selectedElements = (): BoardElement[] => {
    const { elements, selection } = get();
    const ids = new Set(selection);
    return elements.filter((element) => ids.has(element.id));
  };

  const topZ = (): string | null => get().elements.at(-1)?.z ?? null;

  const translate = (
    patches: Map<ElementId, Partial<BoardElement>>,
    root: BoardElement,
    dx: number,
    dy: number,
  ) => {
    if (root.hidden || (dx === 0 && dy === 0)) return;
    const members =
      root.type === 'group' || root.type === 'frame'
        ? withGroupMembers(get().elements, [root.id])
        : [root];
    if (members.some(lockedForMe)) return;
    for (const element of members) {
      if (element.type !== 'group')
        patches.set(element.id, { x: element.x + dx, y: element.y + dy });
    }
  };

  const insertNewElements = (elements: BoardElement[]): void => {
    const frames = new Set(
      elements
        .filter((element) => element.type === 'frame' && !element.parentId)
        .map((element) => element.id),
    );
    if (frames.size === 0) {
      insertElements(board, elements);
      return;
    }

    const frameKeys = reorder([...get().elements, ...elements], frames, 'back');
    insertElements(
      board,
      elements.map((element) => {
        const z = frameKeys.get(element.id);
        return z === undefined ? element : { ...element, z };
      }),
    );
  };

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

    // Someone who answers undoes their own typing: the only changes they have made.
    // This visit's steps come first; then the ones written down on earlier visits.
    undo: () => {
      get().endEditing();
      if (board.readOnly && !board.answers) return;
      if (board.undoManager.canUndo()) board.undoManager.undo();
      else history?.undo();
    },

    // An earlier visit's step undone just now is the newest thing undone, so it comes
    // back first.
    redo: () => {
      get().endEditing();
      if (board.readOnly && !board.answers) return;
      if (!history?.redo()) board.undoManager.redo();
    },

    /**
     * The capture window folds a drag's frames into one undo step, but it would just
     * as happily fold two unrelated actions together. Discrete actions close their
     * step explicitly so each is undone on its own.
     */
    commitUndoStep: () => board.undoManager.stopCapturing(),

    applyDiscrete: (patches) => {
      applyPatches(board, fitHeights(get().elements, patches));
      board.undoManager.stopCapturing();
    },

    setUndoState: ({ canUndo, canRedo }) => set({ canUndo, canRedo }),
    setOnline: (online) => set({ online }),

    devPanelOpen: false,
    shortcutsOpen: false,
    paletteOpen: false,
    contextMenu: null,
    stats: { fps: 0, renderMs: 0, visible: 0 },

    eraserMode: 'drawings',
    inkWidth: 6,
    inkColor: 'var(--shape-1)',
    markerWidth: 20,
    markerColor: '#ffe14d',
    editingId: null,
    croppingId: null,

    beginCrop: (id) => {
      const element = get().elements.find((candidate) => candidate.id === id);
      if (board.readOnly || element?.type !== 'image' || lockedForMe(element)) return;
      get().endEditing();
      bump({ croppingId: id, selection: [id] });
    },

    endCrop: () => {
      if (get().croppingId === null) return;
      board.undoManager.stopCapturing();
      bump({ croppingId: null });
    },

    setViewport: (wanted) => {
      const viewport = guarded(wanted);
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

    panBy: (dx, dy) => set({ viewport: guarded(panByScreen(get().viewport, dx, dy)) }),

    zoomByAt: (screenPoint, factor) => {
      const { viewport } = get();
      set({ viewport: guarded(zoomAt(viewport, screenPoint, viewport.zoom * factor)) });
    },

    zoomStep: (direction) => {
      const { viewport, stageSize } = get();
      const next = direction > 0 ? viewport.zoom * ZOOM_STEP : viewport.zoom / ZOOM_STEP;
      set({ viewport: guarded(zoomAtCenter(viewport, stageSize, next)) });
    },

    zoomTo100: () => {
      const { viewport, stageSize } = get();
      set({ viewport: guarded(zoomAtCenter(viewport, stageSize, 1)) });
    },

    zoomToFit: () => {
      const { elements, stageSize } = get();
      const bounds = unionRects(elements.map(elementAABB));
      if (!bounds) {
        set({ viewport: guarded({ x: -stageSize.width / 2, y: -stageSize.height / 2, zoom: 1 }) });
        return;
      }
      set({ viewport: guarded(fitToRect(bounds, stageSize)) });
    },

    zoomToSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) {
        get().zoomToFit();
        return;
      }
      const bounds = selectionAABB(chosen);
      if (bounds) set({ viewport: guarded(fitToRect(bounds, get().stageSize)) });
    },

    // Someone who may only view keeps the tools that change nothing.
    setTool: (tool) => {
      if (board.readOnly && !VIEWER_TOOLS.has(tool)) return;
      // Picking up another tool puts down what was selected: drawing or erasing is
      // not done to the selection, and handles left on it only get in the way.
      const another = tool !== get().tool && tool !== 'select';
      bump(another ? { tool, selection: [], croppingId: null } : { tool });
    },
    setStamp: (stamp) => {
      if (board.readOnly) return;
      bump({ tool: 'stamp', stamp });
    },
    setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
    setPanning: (panning) => set({ panning }),
    setSnapEnabled: (snapEnabled) => set({ snapEnabled }),

    addElement: (element) => {
      insertNewElements([element]);
      bump({ selection: [element.id] });
    },

    addElements: (elements) => {
      if (elements.length === 0) return;
      insertNewElements(elements);
      bump({
        selection: elements.filter((element) => !element.parentId).map((element) => element.id),
      });
    },

    patchElements: (patches) => applyPatches(board, fitHeights(get().elements, patches)),

    replaceElements: (elements) => replaceAll(board, elements),

    deleteSelection: () => {
      // A locked thing is not deleted by accident: unlocked first, on purpose.
      const { elements, selection } = get();
      const doomed = new Set<ElementId>();
      for (const id of selection) {
        const members = withGroupMembers(elements, [id]);
        if (!members.some(lockedForMe)) for (const element of members) doomed.add(element.id);
      }
      if (doomed.size === 0) return;

      deleteElements(board, [...doomed]);
      bump({ selection: selection.filter((id) => !doomed.has(id)) });
    },

    duplicateSelection: (placement = 'below') => {
      const { elements, selection } = get();
      const chosen = withGroupMembers(elements, selection);
      if (chosen.length === 0) return;

      // Below the whole selection, a little apart, left edges lined up: never on top of it.
      const dy = placement === 'below' ? (selectionAABB(chosen)?.h ?? 0) + DUPLICATE_GAP : 0;
      const x = Math.min(...chosen.map((element) => element.x));
      const y = Math.min(...chosen.map((element) => element.y));
      const copies = copiesOf(chosen, { x, y: y + dy }, topZ(), { keepExternalBindings: true });

      insertNewElements(copies);
      bump({ selection: copies.filter((copy) => !copy.parentId).map((copy) => copy.id) });
    },

    nudgeSelection: (dx, dy) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) translate(patches, element, dx, dy);
      get().applyDiscrete(patches);
    },

    selectOnly: (ids) => {
      const croppingId = get().croppingId;
      bump({
        selection: [...ids],
        ...(croppingId && !ids.includes(croppingId) ? { croppingId: null } : {}),
      });
    },

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

    clearSelection: () => bump({ selection: [], croppingId: null }),

    setDraft: (draft) => bump({ draft }),
    setMarquee: (marquee) => bump({ marquee }),
    setSnapFeedback: (guides, spacing) => bump({ guides, spacing }),
    setRotationReadout: (rotationReadout) => bump({ rotationReadout }),

    groupSelection: () => {
      const chosen = selectedElements().filter((element) => !element.parentId);
      if (chosen.length < 2) return;
      const members = withGroupMembers(get().elements, get().selection);
      if (
        members.filter((element) => element.type === 'frame').length > 1 ||
        members.some(lockedForMe)
      )
        return;
      const frame = chosen.find((element) => element.type === 'frame');
      if (frame) {
        get().applyDiscrete(
          new Map(
            chosen
              .filter((item) => item !== frame)
              .map((item) => [item.id, { parentId: frame.id, frameDetached: false }]),
          ),
        );
        bump({ selection: [frame.id] });
        return;
      }
      if (chosen.some((element) => element.type === 'group')) return;

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

    groupDroppedItems: (ids, moving) => {
      if (board.readOnly) return;
      const { elements, selection } = get();
      const frames = elements.filter(
        (element) =>
          element.type === 'frame' &&
          !element.hidden &&
          !element.parentId &&
          !lockedForMe(element) &&
          !moving.has(element.id),
      );
      if (frames.length === 0) return;
      const dragged = new Set(ids);
      const parents = new Map<ElementId, ElementId>();
      for (const item of elements) {
        if (!dragged.has(item.id) || item.type === 'frame' || item.hidden || item.parentId)
          continue;
        const members = item.type === 'group' ? withGroupMembers(elements, [item.id]) : [item];
        if (
          !members.some((element) => moving.has(element.id)) ||
          members.some((element) => element.type === 'frame' || lockedForMe(element))
        )
          continue;
        const frame = overlappingFrame(item, frames);
        if (frame) parents.set(item.id, frame.id);
      }
      if (parents.size === 0) return;
      // Use the drag's local transaction origin. The pointer handler closes its undo step.
      // A pause before releasing the pointer may exceed Yjs's normal capture window.
      if (board.undoManager.lastChange > 0) board.undoManager.lastChange = Date.now();
      applyPatches(
        board,
        new Map([...parents].map(([id, parentId]) => [id, { parentId, frameDetached: false }])),
      );
      bump({ selection: [...new Set(selection.map((id) => parents.get(id) ?? id))] });
    },

    ungroupSelection: () => {
      const { elements } = get();
      const groups = selectedElements().filter((element) => canUngroup(element, elements));
      if (groups.length === 0) return;
      const byId = new Map(groups.map((group) => [group.id, group]));

      const freed = get().elements.filter(
        (element) => element.parentId && byId.has(element.parentId),
      );

      transactLocal(board, () => {
        for (const element of freed) {
          const group = byId.get(element.parentId!)!;
          const map = board.elements.get(element.id);
          if (map)
            patchYElement(map, {
              parentId: group.parentId,
              ...(group.type === 'frame' || group.frameDetached ? { frameDetached: true } : {}),
            });
        }
        for (const group of groups) {
          if (group.type === 'group') board.elements.delete(group.id);
        }
      });
      get().commitUndoStep();
      if (freed.length) bump({ selection: freed.map((element) => element.id) });
    },

    toggleLockSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;
      // A mixed selection is locked rather than unlocked; unlocking takes either kind.
      get().setSelectionLocked(chosen.some((element) => !element.locked));
    },

    setSelectionLocked: (locked, mode = 'all') => {
      if (locked && mode === 'others' && !mayLockForOthers()) return;
      const lockMode = locked && mode === 'others' ? 'others' : null;
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) {
        if (element.locked !== locked || (element.lockMode ?? null) !== lockMode) {
          patches.set(element.id, { locked, lockMode });
        }
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
      const members = withGroupMembers(elements, selection);
      const keys = reorder(elements, new Set(members.map((item) => item.id)), command);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const [id, z] of keys) patches.set(id, { z });
      get().applyDiscrete(patches);
    },

    fitSelectionWidth: () => {
      const state = get();
      const frame = selectFitWidthFrame(state);
      const element = state.elements.find((item) => item.id === state.selection[0]);
      if (!frame || !element) return;
      const patch = fitWidthPatch(element, frame);
      if (
        Math.abs(patch.x - element.x) < 1e-6 &&
        Math.abs(patch.y - element.y) < 1e-6 &&
        Math.abs(patch.w - element.w) < 1e-6 &&
        Math.abs(patch.h - element.h) < 1e-6
      ) {
        return;
      }
      state.applyDiscrete(new Map([[element.id, patch]]));
    },

    alignSelection: (edge) => {
      const { elements } = get();
      const chosen = selectedElements();
      if (chosen.length < 2) return;
      const items = chosen.map((element) => layoutBox(element, elements));
      const bounds = selectionAABB(items);
      if (!bounds) return;

      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of items) {
        const box = elementAABB(element);
        switch (edge) {
          case 'left':
            translate(patches, element, bounds.x - box.x, 0);
            break;
          case 'right':
            translate(patches, element, bounds.x + bounds.w - box.w - box.x, 0);
            break;
          case 'hcentre':
            translate(patches, element, bounds.x + (bounds.w - box.w) / 2 - box.x, 0);
            break;
          case 'top':
            translate(patches, element, 0, bounds.y - box.y);
            break;
          case 'bottom':
            translate(patches, element, 0, bounds.y + bounds.h - box.h - box.y);
            break;
          case 'vcentre':
            translate(patches, element, 0, bounds.y + (bounds.h - box.h) / 2 - box.y);
            break;
        }
      }
      get().applyDiscrete(patches);
    },

    distributeSelection: (axis) => {
      const { elements } = get();
      const chosen = selectedElements();
      if (chosen.length < 3) return;

      const boxes = chosen
        .map((element) => ({ element, box: elementAABB(layoutBox(element, elements)) }))
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
        if (axis === 'x') translate(patches, element, cursor - box.x, 0);
        else translate(patches, element, 0, cursor - box.y);
        cursor += (axis === 'x' ? box.w : box.h) + gap;
      }
      get().applyDiscrete(patches);
    },

    arrangeSelection: (direction, gap = DEFAULT_ARRANGE_GAP) => {
      const { elements } = get();
      const chosen = selectedElements().filter((element) => !element.hidden);
      if (
        chosen.length < 2 ||
        withGroupMembers(
          elements,
          chosen.map((item) => item.id),
        ).some(lockedForMe)
      )
        return;
      const row = direction === 'row';
      const items = orderedForArrangement(
        chosen.map((element) => layoutBox(element, elements)),
        direction,
      );
      const cross = Math.min(...items.map((item) => item.cross));
      const patches = new Map<ElementId, Partial<BoardElement>>();
      let cursor = items[0]!.start;
      for (const item of items) {
        const along = cursor - item.start;
        const across = cross - item.cross;
        translate(patches, item.element, row ? along : across, row ? across : along);
        cursor += item.size + gap;
      }
      get().applyDiscrete(patches);
    },

    changeArrangementGap: (step) => {
      const current = selectArrangement(get());
      if (!current) return;
      get().arrangeSelection(current.direction, Math.max(0, current.gap + step * ARRANGE_GAP_STEP));
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
      const { elements, selection } = get();
      const gone = new Set<ElementId>();
      for (const id of ids) {
        const members = withGroupMembers(elements, [id]);
        if (
          members.some(
            (item) =>
              item.type === 'image' || lockedForMe(item) || lockedForMe(groupRoot(item, elements)),
          )
        )
          continue;
        for (const item of members) gone.add(item.id);
      }
      if (!gone.size) return;
      deleteElements(board, [...gone]);
      bump({ selection: selection.filter((id) => !gone.has(id)) });
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
      // A text box grows to hold what is typed, so nothing spills out of reach of a click;
      // one whose height follows its text shrinks back, too.
      let patch: Partial<BoardElement> = { text };
      if (element?.autoHeight) {
        patch = fitted(element, patch);
      } else if (element?.type === 'text') {
        const needed = textHeight(element, text);
        if (needed !== null && needed > element.h) patch = { text, h: needed };
      }
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
      // Bold is wider: a box that follows its text may now wrap onto another line.
      const element = get().elements.find((candidate) => candidate.id === id);
      const height = element?.autoHeight ? fitted(element, {}).h : undefined;
      if (height !== undefined) transactAnswer(board, id, () => patchYElement(map, { h: height }));
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

/** Whether the tool in hand has settings to show: the pen, the highlighter, the eraser. */
export function hasToolOptions(tool: Tool): boolean {
  return tool === 'pen' || tool === 'highlighter' || tool === 'eraser';
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

/** The open board's undo, written down so that it outlives the visit. */
let history: History | null = null;

/**
 * Where the open board's undo is kept in this browser: per board and per person, so
 * someone else signing in here does not inherit it. The signed-out board has one.
 */
function historyKey(): string | null {
  if (!canPersist || isAudienceWindow()) return null;
  if (openBoardId === null) return 'local';
  return `${useWorkspace.getState().account?.uid ?? 'guest'}/${openBoardId}`;
}

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
  history?.destroy();
  stopWatchingWork?.();

  // Once the person has started working on the board, a copy arriving later (the
  // room's, a moment after opening) leaves their view where it is.
  const onWork = (transaction: Transaction) => {
    const own = transaction.origin === LOCAL_ORIGIN || transaction.origin === HISTORY_ORIGIN;
    if (own && transaction.changed.size > 0) openFit.from = null;
  };
  doc.doc.on('afterTransaction', onWork);
  stopWatchingWork = () => doc.doc.off('afterTransaction', onWork);

  const syncUndoState = () =>
    useBoardStore.getState().setUndoState({
      canUndo: doc.undoManager.canUndo() || (history?.canUndo() ?? false),
      canRedo: doc.undoManager.canRedo() || (history?.canRedo() ?? false),
    });

  // Before the binding, so it hears every change; before the listeners below, so a new
  // change has already dropped the older steps it undid when they ask.
  history = trackHistory(doc, historyKey(), syncUndoState);

  // The binding sees every page; the store, and so everything drawn and picked, only
  // the one in view.
  binding = bindBoard(
    doc,
    (all) => {
      const elements = all.filter((element) => pageOf(element) === doc.currentPage);
      useBoardStore.setState((state) => {
        const selected = new Set(state.selection);
        const selection = selected.size
          ? elements
              .filter((element) => selected.has(element.id))
              .map((element) => {
                // A remote drop or redo can group an item we already had selected.
                const root = groupRoot(element, elements);
                return root.type === 'frame' && state.croppingId !== element.id
                  ? root.id
                  : element.id;
              })
          : [];
        return {
          elements,
          renderVersion: state.renderVersion + 1,
          selection: [...new Set(selection)],
        };
      });
    },
    history.noteChanges,
  );

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

  doc.undoManager.on('stack-item-added', syncUndoState);
  doc.undoManager.on('stack-item-popped', syncUndoState);
  doc.undoManager.on('stack-cleared', syncUndoState);
  syncUndoState();

  for (const listener of attachListeners) listener(doc);

  useBoardStore.setState({ hydrated: false });
  void doc.whenReady.then(() => {
    useBoardStore.setState({ hydrated: true });
    if (doc === board) {
      dropOldPages();
      fitOnOpen();
    }
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
let viewportGuard: ((viewport: Viewport) => Viewport) | null = null;
const guarded = (viewport: Viewport): Viewport =>
  viewportGuard ? viewportGuard(viewport) : viewport;

/**
 * Bounds every change of view while it is set: presenting keeps the view on the slide
 * (`keepOnSlide`). Null lets the view go anywhere again.
 */
export function setViewportGuard(guard: ((viewport: Viewport) => Viewport) | null): void {
  viewportGuard = guard;
  if (guard) {
    const { viewport } = useBoardStore.getState();
    const next = guard(viewport);
    if (!viewportsEqual(viewport, next)) useBoardStore.setState({ viewport: next });
  }
}

/**
 * A board that still has pages from before they were removed keeps its first; done
 * by someone who may edit (the board is not read-only), once the board's content is in (stored, or the room's).
 */
export function dropOldPages(): void {
  if (dropExtraPages(board)) useBoardStore.getState().setPage(FIRST_PAGE);
}

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
    croppingId: null,
    draft: null,
    marquee: null,
    page: FIRST_PAGE,
    viewport: loadViewport(),
  });
  expectFitOnOpen();

  previous.destroy();
  return board;
}

/**
 * The audience window's board: in memory, read-only, filled from the presenter's
 * window (`src/pages/AudienceView.tsx`).
 */
export function openAudienceDocument(): BoardDoc {
  const previous = board;
  openBoardId = null;
  board = createBoard();
  board.readOnly = true;
  attachDocument(board);
  useBoardStore.setState({ selection: [], editingId: null, draft: null, tool: 'hand' });
  previous.destroy();
  return board;
}

if (typeof window !== 'undefined') {
  const report = () => useBoardStore.getState().setOnline(navigator.onLine);
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
}

// The camera follows you back after a reload, but stays out of the shared document.
// Not the audience window's, which is fitted to the slide and must not overwrite it.
useBoardStore.subscribe((state, previous) => {
  if (state.viewport !== previous.viewport && !isAudienceWindow()) saveViewport(state.viewport);
});
