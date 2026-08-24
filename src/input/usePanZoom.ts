import { useEffect, type RefObject } from 'react';
import { clamp, distance, type Point } from '@/geometry';
import { effectiveTool, useBoardStore } from '@/state/boardStore';

/** Line- and page-mode wheel deltas, normalised to pixels. */
function wheelDeltaToPixels(event: WheelEvent, hostHeight: number): { dx: number; dy: number } {
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? hostHeight : 1;
  return { dx: event.deltaX * scale, dy: event.deltaY * scale };
}

function centroidOf(points: Iterable<Point>): Point {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    count += 1;
  }
  return count === 0 ? { x: 0, y: 0 } : { x: x / count, y: y / count };
}

function spreadOf(points: Point[]): number {
  const [a, b] = points;
  return a && b ? distance(a, b) : 0;
}

/**
 * Every way of moving the camera: wheel and trackpad, pinch, middle-drag, and the
 * hand tool (or a held space bar). Listeners are attached by hand rather than
 * through React props because wheel and touch handlers must be non-passive to
 * preventDefault — otherwise the browser zooms the page instead of the board.
 */
export function usePanZoom(hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const toLocal = (event: { clientX: number; clientY: number }): Point => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const store = useBoardStore.getState();
      const { dx, dy } = wheelDeltaToPixels(event, host.clientHeight);

      // A trackpad pinch arrives as ctrl+wheel with small deltas; ctrl/⌘+wheel from a
      // mouse arrives with large ones. Clamping keeps a single formula usable for both.
      if (event.ctrlKey || event.metaKey) {
        store.zoomByAt(toLocal(event), Math.exp(-clamp(dy, -50, 50) * 0.005));
        return;
      }

      if (event.shiftKey) {
        store.panBy(-(dy !== 0 ? dy : dx), 0);
        return;
      }

      store.panBy(-dx, -dy);
    };

    const pointers = new Map<number, Point>();
    let pinchCentroid: Point | null = null;
    let pinchSpread = 0;
    let panPointerId: number | null = null;
    let panLast: Point | null = null;

    const endPan = () => {
      panPointerId = null;
      panLast = null;
      if (useBoardStore.getState().panning) useBoardStore.getState().setPanning(false);
    };

    const shouldStartPan = (event: PointerEvent): boolean => {
      if (event.button === 1) return true; // middle mouse, whatever the tool
      if (event.button !== 0) return false;
      return effectiveTool(useBoardStore.getState()) === 'hand';
    };

    const onPointerDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, toLocal(event));

      if (pointers.size === 2) {
        // A second finger converts a drag into a pinch.
        endPan();
        const points = [...pointers.values()];
        pinchCentroid = centroidOf(points);
        pinchSpread = spreadOf(points);
        return;
      }

      if (pointers.size === 1 && shouldStartPan(event)) {
        event.preventDefault();
        host.setPointerCapture(event.pointerId);
        panPointerId = event.pointerId;
        panLast = toLocal(event);
        useBoardStore.getState().setPanning(true);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      const local = toLocal(event);
      pointers.set(event.pointerId, local);
      const store = useBoardStore.getState();

      if (pointers.size >= 2) {
        const points = [...pointers.values()];
        const centroid = centroidOf(points);
        const spread = spreadOf(points);

        if (pinchCentroid) {
          store.panBy(centroid.x - pinchCentroid.x, centroid.y - pinchCentroid.y);
        }
        if (pinchSpread > 0 && spread > 0) {
          store.zoomByAt(centroid, spread / pinchSpread);
        }

        pinchCentroid = centroid;
        pinchSpread = spread;
        return;
      }

      if (event.pointerId === panPointerId && panLast) {
        store.panBy(local.x - panLast.x, local.y - panLast.y);
        panLast = local;
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);

      if (pointers.size < 2) {
        pinchCentroid = null;
        pinchSpread = 0;
      }
      if (event.pointerId === panPointerId) {
        if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
        endPan();
      }
    };

    const onBlur = () => {
      pointers.clear();
      pinchCentroid = null;
      pinchSpread = 0;
      endPan();
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onBlur);

    return () => {
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hostRef]);
}
