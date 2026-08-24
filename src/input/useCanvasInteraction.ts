import { useEffect, type RefObject } from 'react';
import { screenToBoard, type Viewport } from '@/canvas/viewport';
import { HANDLE_SIZE, ROTATE_ZONE } from '@/canvas/renderOverlay';
import { clamp, distance, rectFromPoints, unionRects, type Point, type Rect } from '@/geometry';
import { elementAABB, rotateAround } from '@/model/bounds';
import {
  createElement,
  isInteractive,
  MIN_SIZE,
  type BoardElement,
  type ElementId,
} from '@/model/element';
import { frameCentre, handlePoint, selectionFrame, type SelectionFrame } from '@/model/handles';
import { elementAt, elementsInMarquee } from '@/model/hitTest';
import {
  angleFromCentre,
  cursorForHandle,
  HANDLES,
  resizeBox,
  scaleBoxInto,
  snapRotation,
  degreesOf,
  type HandleId,
} from '@/model/transform';
import { keyBetween } from '@/model/zorder';
import { snapMove, EMPTY_SNAP } from '@/snapping/snap';
import { effectiveTool, isShapeTool, useBoardStore } from '@/state/boardStore';

const PICK_SLOP = 6; // screen px of forgiveness when clicking thin shapes
const SNAP_DISTANCE = 6; // screen px
const DRAG_THRESHOLD = 3; // screen px before a click becomes a drag
const DEFAULT_SHAPE = { width: 120, height: 90 }; // placed by a click with no drag

type Drag =
  | { kind: 'none' }
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'marquee'; pointerId: number; origin: Point; additive: boolean }
  | { kind: 'draw'; pointerId: number; origin: Point; element: BoardElement; moved: boolean }
  | {
      kind: 'move';
      pointerId: number;
      origin: Point;
      start: Map<ElementId, Point>;
      moved: boolean;
    }
  | {
      kind: 'resize';
      pointerId: number;
      handle: HandleId;
      frame: SelectionFrame;
      start: BoardElement[];
    }
  | {
      kind: 'rotate';
      pointerId: number;
      centre: Point;
      startPointerAngle: number;
      start: Map<ElementId, { rotation: number; centre: Point }>;
    };

function wheelDeltaToPixels(event: WheelEvent, hostHeight: number) {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? hostHeight : 1;
  return { dx: event.deltaX * scale, dy: event.deltaY * scale };
}

const centroidOf = (points: Point[]): Point => {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((total, p) => ({ x: total.x + p.x, y: total.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
};

const spreadOf = (points: Point[]): number => {
  const [a, b] = points;
  return a && b ? distance(a, b) : 0;
};

/** Selection plus everything inside any selected group. */
function transformTargets(): BoardElement[] {
  const { elements, selection } = useBoardStore.getState();
  const ids = new Set(selection);
  return elements.filter(
    (element) =>
      isInteractive(element) &&
      element.type !== 'group' &&
      (ids.has(element.id) || (element.parentId !== null && ids.has(element.parentId))),
  );
}

/** Which handle, if any, the pointer is over — and whether it is the rotation ring. */
function hitHandle(
  frame: SelectionFrame,
  board: Point,
  zoom: number,
): { handle: HandleId; rotate: boolean } | null {
  const handleReach = HANDLE_SIZE / zoom;
  const rotateReach = ROTATE_ZONE / zoom;

  for (const handle of HANDLES) {
    if (distance(board, handlePoint(frame, handle)) <= handleReach) {
      return { handle, rotate: false };
    }
  }

  // Rotation lives just outside each corner, which is why it is checked second.
  for (const handle of ['nw', 'ne', 'se', 'sw'] as const) {
    const point = handlePoint(frame, handle);
    const gap = distance(board, point);
    if (gap > handleReach && gap <= rotateReach) return { handle, rotate: true };
  }

  return null;
}

export function useCanvasInteraction(hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const local = (event: { clientX: number; clientY: number }): Point => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const board = (event: { clientX: number; clientY: number }, vp?: Viewport): Point =>
      screenToBoard(vp ?? useBoardStore.getState().viewport, local(event));

    const setCursor = (value: string) => {
      if (host.dataset.cursor !== value) host.dataset.cursor = value;
    };

    let drag: Drag = { kind: 'none' };
    const pointers = new Map<number, Point>();
    let pinchCentroid: Point | null = null;
    let pinchSpread = 0;

    /* ----------------------------- wheel ----------------------------- */

    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-hud]')) return;
      event.preventDefault();
      const store = useBoardStore.getState();
      const { dx, dy } = wheelDeltaToPixels(event, host.clientHeight);

      if (event.ctrlKey || event.metaKey) {
        store.zoomByAt(local(event), Math.exp(-clamp(dy, -50, 50) * 0.005));
        return;
      }
      if (event.shiftKey) {
        store.panBy(-(dy !== 0 ? dy : dx), 0);
        return;
      }
      store.panBy(-dx, -dy);
    };

    /* ------------------------- pointer down -------------------------- */

    const beginPan = (event: PointerEvent) => {
      host.setPointerCapture(event.pointerId);
      drag = { kind: 'pan', pointerId: event.pointerId, last: local(event) };
      useBoardStore.getState().setPanning(true);
      setCursor('grabbing');
    };

    const beginDraw = (event: PointerEvent) => {
      const store = useBoardStore.getState();
      const tool = store.tool;
      if (!isShapeTool(tool)) return;

      const origin = board(event);
      const element = createElement({
        type: tool,
        box: { x: origin.x, y: origin.y, w: 0, h: 0 },
        z: keyBetween(store.elements.at(-1)?.z ?? null, null),
      });

      host.setPointerCapture(event.pointerId);
      drag = { kind: 'draw', pointerId: event.pointerId, origin, element, moved: false };
      store.setDraft(element);
    };

    const beginMove = (event: PointerEvent) => {
      const origin = board(event);
      const start = new Map<ElementId, Point>();
      for (const element of transformTargets())
        start.set(element.id, { x: element.x, y: element.y });
      if (start.size === 0) return false;

      host.setPointerCapture(event.pointerId);
      drag = { kind: 'move', pointerId: event.pointerId, origin, start, moved: false };
      return true;
    };

    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-hud]')) return;

      pointers.set(event.pointerId, local(event));
      if (pointers.size === 2) {
        drag = { kind: 'none' };
        useBoardStore.getState().setPanning(false);
        const points = [...pointers.values()];
        pinchCentroid = centroidOf(points);
        pinchSpread = spreadOf(points);
        return;
      }
      if (pointers.size > 2) return;

      const store = useBoardStore.getState();
      const tool = effectiveTool(store);

      if (event.button === 1 || tool === 'hand') {
        event.preventDefault();
        beginPan(event);
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();

      if (isShapeTool(tool)) {
        beginDraw(event);
        return;
      }

      const point = board(event);
      const zoom = store.viewport.zoom;
      const selected = store.elements.filter((element) => store.selection.includes(element.id));
      const frame = selectionFrame(selected);
      const anyLocked = selected.some((element) => element.locked);

      // 1. Transform handles win over everything beneath them.
      if (frame && !anyLocked) {
        const hit = hitHandle(frame, point, zoom);
        if (hit?.rotate) {
          host.setPointerCapture(event.pointerId);
          const centre = frameCentre(frame);
          const start = new Map<ElementId, { rotation: number; centre: Point }>();
          for (const element of transformTargets()) {
            start.set(element.id, {
              rotation: element.rotation,
              centre: { x: element.x + element.w / 2, y: element.y + element.h / 2 },
            });
          }
          drag = {
            kind: 'rotate',
            pointerId: event.pointerId,
            centre,
            startPointerAngle: angleFromCentre(centre, point),
            start,
          };
          return;
        }
        if (hit) {
          host.setPointerCapture(event.pointerId);
          drag = {
            kind: 'resize',
            pointerId: event.pointerId,
            handle: hit.handle,
            frame,
            start: selected.map((element) => ({ ...element })),
          };
          return;
        }
      }

      // 2. Then whatever element is under the pointer.
      const target = elementAt(store.elements, point, PICK_SLOP / zoom);
      const targetId = target?.parentId ?? target?.id ?? null;

      if (targetId) {
        const alreadySelected = store.selection.includes(targetId);
        if (event.shiftKey) {
          store.toggleSelected(targetId);
          if (!alreadySelected) beginMove(event);
          return;
        }
        if (!alreadySelected) store.selectOnly([targetId]);

        // Alt-drag leaves the original behind and moves a copy.
        if (event.altKey) useBoardStore.getState().duplicateSelection(0);
        beginMove(event);
        return;
      }

      // 3. Empty canvas: rubber-band select.
      if (!event.shiftKey) store.clearSelection();
      host.setPointerCapture(event.pointerId);
      drag = {
        kind: 'marquee',
        pointerId: event.pointerId,
        origin: point,
        additive: event.shiftKey,
      };
    };

    /* ------------------------- pointer move -------------------------- */

    const snapCandidates = (excluded: ReadonlySet<ElementId>): Rect[] => {
      const { elements } = useBoardStore.getState();
      const candidates: Rect[] = [];
      for (const element of elements) {
        if (element.hidden || element.type === 'group' || excluded.has(element.id)) continue;
        candidates.push(elementAABB(element));
        if (candidates.length >= 400) break; // plenty to align against, bounded cost
      }
      return candidates;
    };

    /** Last pointer position in client coordinates, so the cursor can be re-evaluated
     *  when the tool changes rather than only when the mouse moves. */
    let lastClient: { clientX: number; clientY: number } | null = null;

    const updateHoverCursor = () => {
      const store = useBoardStore.getState();
      const tool = effectiveTool(store);

      if (tool === 'hand') return setCursor('grab');
      if (isShapeTool(tool)) return setCursor('crosshair');
      if (!lastClient) return setCursor('default');

      const point = board(lastClient);
      const zoom = store.viewport.zoom;
      const selected = store.elements.filter((element) => store.selection.includes(element.id));
      const frame = selectionFrame(selected);

      if (frame && !selected.some((element) => element.locked)) {
        const hit = hitHandle(frame, point, zoom);
        if (hit?.rotate) return setCursor('rotate');
        if (hit) return setCursor(cursorForHandle(hit.handle, frame.rotation));
      }

      const target = elementAt(store.elements, point, PICK_SLOP / zoom, { includeLocked: true });
      if (!target) return setCursor('default');
      if (target.locked) return setCursor('not-allowed');
      return setCursor('move');
    };

    const onPointerMove = (event: PointerEvent) => {
      lastClient = { clientX: event.clientX, clientY: event.clientY };
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, local(event));

      if (pointers.size >= 2) {
        const points = [...pointers.values()];
        const centroid = centroidOf(points);
        const spread = spreadOf(points);
        const store = useBoardStore.getState();
        if (pinchCentroid) store.panBy(centroid.x - pinchCentroid.x, centroid.y - pinchCentroid.y);
        if (pinchSpread > 0 && spread > 0) store.zoomByAt(centroid, spread / pinchSpread);
        pinchCentroid = centroid;
        pinchSpread = spread;
        return;
      }

      if (drag.kind === 'none') {
        updateHoverCursor();
        return;
      }

      const store = useBoardStore.getState();
      const point = board(event);

      switch (drag.kind) {
        case 'pan': {
          const now = local(event);
          store.panBy(now.x - drag.last.x, now.y - drag.last.y);
          drag.last = now;
          break;
        }

        case 'marquee': {
          store.setMarquee(rectFromPoints(drag.origin, point));
          break;
        }

        case 'draw': {
          if (
            Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) * store.viewport.zoom >=
            DRAG_THRESHOLD
          ) {
            drag.moved = true;
          }
          const square = event.shiftKey;
          let box = rectFromPoints(drag.origin, point);
          if (square) {
            const side = Math.max(box.w, box.h);
            box = {
              x: point.x < drag.origin.x ? drag.origin.x - side : drag.origin.x,
              y: point.y < drag.origin.y ? drag.origin.y - side : drag.origin.y,
              w: side,
              h: side,
            };
          }
          const flipX = point.x < drag.origin.x !== point.y < drag.origin.y;
          drag.element = {
            ...drag.element,
            ...box,
            style: { ...drag.element.style, flipX },
          };
          store.setDraft(drag.element);
          break;
        }

        case 'move': {
          const dx = point.x - drag.origin.x;
          const dy = point.y - drag.origin.y;
          if (!drag.moved && Math.hypot(dx, dy) * store.viewport.zoom < DRAG_THRESHOLD) break;
          drag.moved = true;

          const targets = transformTargets();
          const moved = targets.map((element) => {
            const origin = drag.kind === 'move' ? drag.start.get(element.id) : undefined;
            return origin ? { ...element, x: origin.x + dx, y: origin.y + dy } : element;
          });

          const bounds = unionRects(moved.map(elementAABB));
          let snap = EMPTY_SNAP;
          if (bounds && store.snapEnabled && !event.metaKey && !event.ctrlKey) {
            const excluded = new Set(moved.map((element) => element.id));
            snap = snapMove(bounds, snapCandidates(excluded), SNAP_DISTANCE / store.viewport.zoom);
          }

          const patches = new Map<ElementId, Partial<BoardElement>>();
          for (const element of moved) {
            patches.set(element.id, { x: element.x + snap.dx, y: element.y + snap.dy });
          }
          store.patchElements(patches);
          store.setSnapFeedback(snap.guides, snap.spacing);
          break;
        }

        case 'resize': {
          const { frame, handle } = drag;
          const options = {
            fromCentre: event.altKey,
            lockAspect: event.shiftKey,
            minSize: MIN_SIZE,
          };

          const patches = new Map<ElementId, Partial<BoardElement>>();

          if (frame.single) {
            const element = drag.start[0];
            if (element) patches.set(element.id, resizeBox(element, handle, point, options));
          } else {
            const synthetic: BoardElement = {
              ...drag.start[0]!,
              x: frame.box.x,
              y: frame.box.y,
              w: frame.box.w,
              h: frame.box.h,
              rotation: 0,
            };
            const nextBox = resizeBox(synthetic, handle, point, options);
            for (const element of drag.start) {
              patches.set(element.id, scaleBoxInto(elementAABB(element), frame.box, nextBox));
            }
          }
          store.patchElements(patches);
          break;
        }

        case 'rotate': {
          const delta = angleFromCentre(drag.centre, point) - drag.startPointerAngle;
          const patches = new Map<ElementId, Partial<BoardElement>>();
          let readout = 0;

          for (const [id, start] of drag.start) {
            const rotation = snapRotation(start.rotation + delta, event.shiftKey);
            readout = degreesOf(rotation);
            const applied = rotation - start.rotation;
            const centre = rotateAround(start.centre, drag.centre, applied);
            const element = store.elements.find((candidate) => candidate.id === id);
            if (!element) continue;
            patches.set(id, {
              rotation,
              x: centre.x - element.w / 2,
              y: centre.y - element.h / 2,
            });
          }

          store.patchElements(patches);
          store.setRotationReadout(readout);
          break;
        }
      }
    };

    /* -------------------------- pointer up --------------------------- */

    const finishDrag = () => {
      const store = useBoardStore.getState();

      if (drag.kind === 'draw') {
        const dragged = drag.moved;
        const element = dragged
          ? drag.element
          : {
              ...drag.element,
              x: drag.origin.x,
              y: drag.origin.y,
              w: DEFAULT_SHAPE.width,
              h: DEFAULT_SHAPE.height,
            };
        store.setDraft(null);
        // A click without a drag places a default-sized shape rather than a speck.
        store.addElement(element);
        store.setTool('select');
      }

      if (drag.kind === 'marquee') {
        const marquee = store.marquee;
        if (marquee) {
          const hits = elementsInMarquee(store.elements, marquee).map(
            (element) => element.parentId ?? element.id,
          );
          const unique = [...new Set(hits)];
          store.selectOnly(drag.additive ? [...new Set([...store.selection, ...unique])] : unique);
        }
        store.setMarquee(null);
      }

      if (drag.kind === 'pan') store.setPanning(false);
      if (drag.kind === 'move') store.setSnapFeedback([], []);
      if (drag.kind === 'rotate') store.setRotationReadout(null);

      drag = { kind: 'none' };
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) {
        pinchCentroid = null;
        pinchSpread = 0;
      }
      if (drag.kind === 'none' || !('pointerId' in drag) || drag.pointerId !== event.pointerId) {
        return;
      }
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      finishDrag();
    };

    const onBlur = () => {
      pointers.clear();
      pinchCentroid = null;
      pinchSpread = 0;
      if (drag.kind !== 'none') finishDrag();
    };

    let previousTool = effectiveTool(useBoardStore.getState());
    let previousVersion = useBoardStore.getState().renderVersion;
    const unsubscribe = useBoardStore.subscribe((state) => {
      const tool = effectiveTool(state);
      if (tool === previousTool && state.renderVersion === previousVersion) return;
      previousTool = tool;
      previousVersion = state.renderVersion;
      if (drag.kind === 'none') updateHoverCursor();
    });

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onBlur);

    return () => {
      unsubscribe();
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hostRef]);
}
