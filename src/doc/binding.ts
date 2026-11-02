import type * as Y from 'yjs';
import type { BoardElement, ElementId } from '@/model/element';
import { routeConnectors } from '@/model/connectors';
import { selectionAABB } from '@/model/bounds';
import { compareZ } from '@/model/zorder';
import type { BoardDoc } from './board';
import { fromYElement } from './schema';

/**
 * A group's box and a bound connector's endpoints are both *derived* — they follow
 * whatever they contain or attach to. Deriving them on the way out of the document,
 * rather than writing them back into it, keeps the document smaller, avoids an
 * observer that feeds itself, and means every peer computes the same answer from the
 * same inputs instead of racing to store it.
 */
function withGroupBounds(elements: BoardElement[]): BoardElement[] {
  if (!elements.some((element) => element.type === 'group')) return elements;

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

export function deriveView(elements: BoardElement[]): BoardElement[] {
  return routeConnectors(withGroupBounds(elements)).sort(compareZ);
}

export interface BindingHandle {
  /** Rebuilds everything from scratch — used after loading or a bulk replace. */
  refresh: () => void;
  destroy: () => void;
}

/** One element a transaction touched: its id, as it was, and as it is now. */
export type ElementTouch = [ElementId, BoardElement | undefined, BoardElement | undefined];

/**
 * Materialises only the elements a transaction actually touched. Converting all
 * 5,000 on every frame of a drag would cost more than drawing them. `onTouched` hears
 * each transaction's elements before and after, which is how undo is written down.
 */
export function bindBoard(
  board: BoardDoc,
  onChange: (elements: BoardElement[]) => void,
  onTouched?: (transaction: Y.Transaction, touched: ElementTouch[]) => void,
): BindingHandle {
  const cache = new Map<ElementId, BoardElement>();

  let touched: ElementTouch[] | null = null;
  const materialise = (id: ElementId) => {
    const before = cache.get(id);
    const map = board.elements.get(id);
    if (map) cache.set(id, fromYElement(map));
    else cache.delete(id);
    touched?.push([id, before, cache.get(id)]);
  };

  const emit = () => onChange(deriveView([...cache.values()]));

  const refresh = () => {
    cache.clear();
    board.elements.forEach((map, id) => cache.set(id, fromYElement(map)));
    emit();
  };

  // Yjs types the deep-observe callback loosely; the shape used here is stable.
  const onDeep = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction) => {
    touched = onTouched ? [] : null;
    for (const event of events) {
      if (event.path.length === 0) {
        // Elements added to or removed from the board.
        for (const id of event.changes.keys.keys()) materialise(id);
        continue;
      }
      // A change inside one element, possibly nested inside its style.
      const id = event.path[0];
      if (typeof id === 'string') materialise(id);
    }
    if (touched && touched.length > 0) onTouched?.(transaction, touched);
    touched = null;
    emit();
  };

  board.elements.observeDeep(onDeep);
  refresh();

  return {
    refresh,
    destroy: () => board.elements.unobserveDeep(onDeep),
  };
}
