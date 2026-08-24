import { create } from 'zustand';
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
import { scaleBoxInto } from '@/model/transform';
import { compareZ, keyBetween, keysBetween, reorder, type ReorderCommand } from '@/model/zorder';
import { generateDemoElements } from '@/scene/demoElements';
import type { SnapGuide, SpacingMark } from '@/snapping/snap';

export type Tool = 'select' | 'hand' | ShapeType;

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

  devPanelOpen: boolean;
  stats: RenderStatsSnapshot;

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
  reportStats: (stats: RenderStatsSnapshot) => void;
}

const ZOOM_STEP = 1.25;

/** Elements are stored back-to-front so the renderer never has to sort per frame. */
const sorted = (elements: BoardElement[]): BoardElement[] => [...elements].sort(compareZ);

/**
 * A group has no geometry of its own — it is exactly the box around its children. Any
 * change to a child has to be followed by this, or the group's frame drifts away from
 * what it contains.
 */
function withGroupBounds(elements: BoardElement[]): BoardElement[] {
  const hasGroups = elements.some((element) => element.type === 'group');
  if (!hasGroups) return elements;

  const children = new Map<ElementId, BoardElement[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const list = children.get(element.parentId);
    if (list) list.push(element);
    else children.set(element.parentId, [element]);
  }

  return elements.map((element) => {
    if (element.type !== 'group') return element;
    const box = selectionAABB(children.get(element.id) ?? []);
    if (!box) return element;
    if (box.x === element.x && box.y === element.y && box.w === element.w && box.h === element.h) {
      return element;
    }
    return { ...element, ...box };
  });
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

  return {
    viewport: DEFAULT_VIEWPORT,
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

    devPanelOpen: false,
    stats: { fps: 0, renderMs: 0, visible: 0 },

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

    addElement: (element) =>
      bump({ elements: sorted([...get().elements, element]), selection: [element.id] }),

    patchElements: (patches) => {
      if (patches.size === 0) return;
      let zChanged = false;
      const next = get().elements.map((element) => {
        const patch = patches.get(element.id);
        if (!patch) return element;
        if (patch.z !== undefined && patch.z !== element.z) zChanged = true;
        return { ...element, ...patch };
      });
      const reconciled = withGroupBounds(next);
      bump({ elements: zChanged ? sorted(reconciled) : reconciled });
    },

    replaceElements: (elements) => bump({ elements: sorted(withGroupBounds(elements)) }),

    deleteSelection: () => {
      const ids = new Set(get().selection);
      if (ids.size === 0) return;
      // Deleting a group takes its children with it.
      bump({
        elements: get().elements.filter(
          (element) => !ids.has(element.id) && !(element.parentId && ids.has(element.parentId)),
        ),
        selection: [],
      });
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

      bump({
        elements: sorted([...get().elements, ...copies]),
        selection: copies.map((copy) => copy.id),
      });
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
      get().patchElements(patches);
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

      bump({
        elements: sorted([
          ...get().elements.map((element) =>
            ids.has(element.id) ? { ...element, parentId: group.id } : element,
          ),
          group,
        ]),
        selection: [group.id],
      });
    },

    ungroupSelection: () => {
      const groups = selectedElements().filter((element) => element.type === 'group');
      if (groups.length === 0) return;
      const groupIds = new Set(groups.map((group) => group.id));

      const freed: ElementId[] = [];
      const elements = get()
        .elements.filter((element) => !groupIds.has(element.id))
        .map((element) => {
          if (element.parentId && groupIds.has(element.parentId)) {
            freed.push(element.id);
            return { ...element, parentId: null };
          }
          return element;
        });

      bump({ elements, selection: freed });
    },

    toggleLockSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;
      const locking = chosen.some((element) => !element.locked);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) patches.set(element.id, { locked: locking });
      get().patchElements(patches);
    },

    toggleHiddenSelection: () => {
      const chosen = selectedElements();
      if (chosen.length === 0) return;
      const hiding = chosen.some((element) => !element.hidden);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of chosen) patches.set(element.id, { hidden: hiding });
      get().patchElements(patches);
    },

    reorderSelection: (command) => {
      const { elements, selection } = get();
      const keys = reorder(elements, new Set(selection), command);
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const [id, z] of keys) patches.set(id, { z });
      get().patchElements(patches);
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
      get().patchElements(patches);
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
      get().patchElements(patches);
    },

    styleSelection: (patch) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) {
        patches.set(element.id, { style: { ...element.style, ...patch } });
      }
      get().patchElements(patches);
    },

    setSelectionOpacity: (opacity) => {
      const patches = new Map<ElementId, Partial<BoardElement>>();
      for (const element of selectedElements()) patches.set(element.id, { opacity });
      get().patchElements(patches);
    },

    loadDemoElements: (count) => {
      bump({ elements: sorted(generateDemoElements(count, count)), selection: [] });
      get().zoomToFit();
    },

    clearBoard: () =>
      bump({ elements: [], selection: [], draft: null, marquee: null, viewport: DEFAULT_VIEWPORT }),

    toggleDevPanel: () => set((state) => ({ devPanelOpen: !state.devPanelOpen })),
    reportStats: (stats) => set({ stats }),
  };
});

/** The tool actually in effect — holding space temporarily overrides the choice. */
export function effectiveTool(state: Pick<BoardState, 'tool' | 'spaceHeld'>): Tool {
  return state.spaceHeld ? 'hand' : state.tool;
}

export function isShapeTool(tool: Tool): tool is ShapeType {
  return tool !== 'select' && tool !== 'hand';
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
