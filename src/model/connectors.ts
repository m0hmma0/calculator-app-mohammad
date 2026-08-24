import type { Point } from '@/geometry';
import { elementAABB } from './bounds';
import { isConnector, type BoardElement, type ElementId } from './element';
import { boxFromEnds } from './shapePath';

/** Where a line from `towards` first meets this element's box. */
function edgePoint(element: BoardElement, towards: Point): Point {
  const box = elementAABB(element);
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const dx = towards.x - centre.x;
  const dy = towards.y - centre.y;
  if (dx === 0 && dy === 0) return centre;

  const halfWidth = box.w / 2;
  const halfHeight = box.h / 2;
  // Scale the direction until it lands on whichever edge it reaches first.
  const scale = Math.min(
    dx === 0 ? Infinity : halfWidth / Math.abs(dx),
    dy === 0 ? Infinity : halfHeight / Math.abs(dy),
  );
  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}

function centreOf(element: BoardElement): Point {
  const box = elementAABB(element);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * A bound connector has no geometry of its own: both ends are derived from whatever
 * it is attached to, so moving either shape re-routes the arrow. Unbound ends keep
 * whatever the user drew.
 */
export function routeConnectors(elements: BoardElement[]): BoardElement[] {
  const bound = elements.some((element) => isConnector(element) && (element.from || element.to));
  if (!bound) return elements;

  const byId = new Map<ElementId, BoardElement>(elements.map((element) => [element.id, element]));

  return elements.map((element) => {
    if (!isConnector(element) || (!element.from && !element.to)) return element;

    const fromElement = element.from ? byId.get(element.from.elementId) : undefined;
    const toElement = element.to ? byId.get(element.to.elementId) : undefined;
    if (!fromElement && !toElement) return element;

    const corners = element.style.flipX
      ? [
          { x: element.x, y: element.y + element.h },
          { x: element.x + element.w, y: element.y },
        ]
      : [
          { x: element.x, y: element.y },
          { x: element.x + element.w, y: element.y + element.h },
        ];
    const [drawnStart, drawnEnd] = element.style.reverse
      ? [corners[1]!, corners[0]!]
      : [corners[0]!, corners[1]!];

    const startCentre = fromElement ? centreOf(fromElement) : drawnStart;
    const endCentre = toElement ? centreOf(toElement) : drawnEnd;

    const start = fromElement ? edgePoint(fromElement, endCentre) : drawnStart;
    const end = toElement ? edgePoint(toElement, startCentre) : drawnEnd;

    const { x, y, w, h, flipX, reverse } = boxFromEnds(start, end);

    if (
      element.x === x &&
      element.y === y &&
      element.w === w &&
      element.h === h &&
      element.style.flipX === flipX &&
      element.style.reverse === reverse
    ) {
      return element;
    }
    return { ...element, x, y, w, h, style: { ...element.style, flipX, reverse } };
  });
}

/** True when this connector should follow something rather than be dragged. */
export function isBound(element: BoardElement): boolean {
  return isConnector(element) && Boolean(element.from || element.to);
}
