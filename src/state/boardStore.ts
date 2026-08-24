import { create } from 'zustand';
import type { Rect } from '@/geometry';
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
import { generateDemoShapes, sceneBounds, type DemoShape } from '@/scene/demoScene';

export type Tool = 'select' | 'hand';

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

  shapes: DemoShape[];
  /** Bumped whenever `shapes` changes, so caches (the minimap) know to rebuild. */
  sceneVersion: number;

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

  loadDemoShapes: (count: number) => void;
  clearShapes: () => void;

  toggleDevPanel: () => void;
  reportStats: (stats: RenderStatsSnapshot) => void;
}

const ZOOM_STEP = 1.25;

export const useBoardStore = create<BoardState>((set, get) => ({
  viewport: DEFAULT_VIEWPORT,
  stageSize: { width: 1, height: 1 },

  tool: 'select',
  spaceHeld: false,
  panning: false,

  shapes: [],
  sceneVersion: 0,

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
    const { shapes, stageSize } = get();
    const bounds: Rect | null = sceneBounds(shapes);
    if (!bounds) {
      set({ viewport: { x: -stageSize.width / 2, y: -stageSize.height / 2, zoom: 1 } });
      return;
    }
    set({ viewport: fitToRect(bounds, stageSize) });
  },

  // Phase 2 gives this a real selection to frame; until then it falls back to the
  // whole board, which is what "fit what matters" means when nothing is selected.
  zoomToSelection: () => get().zoomToFit(),

  setTool: (tool) => set({ tool }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  setPanning: (panning) => set({ panning }),

  loadDemoShapes: (count) => {
    const shapes = generateDemoShapes(count, count);
    set((state) => ({ shapes, sceneVersion: state.sceneVersion + 1 }));
    get().zoomToFit();
  },

  clearShapes: () =>
    set((state) => ({
      shapes: [],
      sceneVersion: state.sceneVersion + 1,
      viewport: DEFAULT_VIEWPORT,
    })),

  toggleDevPanel: () => set((state) => ({ devPanelOpen: !state.devPanelOpen })),

  reportStats: (stats) => set({ stats }),
}));

/** The tool actually in effect — holding space temporarily overrides the choice. */
export function effectiveTool(state: Pick<BoardState, 'tool' | 'spaceHeld'>): Tool {
  return state.spaceHeld ? 'hand' : state.tool;
}

export function clampedZoom(zoom: number): number {
  return clampZoom(zoom);
}
