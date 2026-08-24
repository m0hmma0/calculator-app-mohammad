import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { BoardElement, ElementId } from './element';

/**
 * Stacking order is a sortable string per element rather than an integer index, so
 * "send backward" rewrites one element instead of renumbering the board — and two
 * people reordering at the same time cannot collide. Phase 7 depends on this.
 */

export function keyBetween(below: string | null, above: string | null): string {
  return generateKeyBetween(below, above);
}

export function keysBetween(below: string | null, above: string | null, count: number): string[] {
  return generateNKeysBetween(below, above, count);
}

export function compareZ(a: BoardElement, b: BoardElement): number {
  if (a.z < b.z) return -1;
  if (a.z > b.z) return 1;
  return a.id < b.id ? -1 : 1;
}

/** Back to front — the order they should be painted in. */
export function sortByZ(elements: readonly BoardElement[]): BoardElement[] {
  return [...elements].sort(compareZ);
}

export type ReorderCommand = 'forward' | 'backward' | 'front' | 'back';

/**
 * Returns the new z key for each moved element. Moving several at once keeps their
 * relative order, and stepping past a neighbour means landing between that neighbour
 * and the one beyond it.
 */
export function reorder(
  all: readonly BoardElement[],
  moving: ReadonlySet<ElementId>,
  command: ReorderCommand,
): Map<ElementId, string> {
  const ordered = sortByZ(all);
  const selected = ordered.filter((element) => moving.has(element.id));
  const rest = ordered.filter((element) => !moving.has(element.id));
  const result = new Map<ElementId, string>();

  if (selected.length === 0) return result;

  if (command === 'front' || command === 'back') {
    const anchor = command === 'front' ? (rest.at(-1)?.z ?? null) : null;
    const other = command === 'front' ? null : (rest[0]?.z ?? null);
    const keys = keysBetween(anchor, other, selected.length);
    selected.forEach((element, index) => result.set(element.id, keys[index]!));
    return result;
  }

  if (command === 'forward') {
    // The first unselected element above the top of the selection.
    const topIndex = ordered.lastIndexOf(selected.at(-1)!);
    const above = ordered.slice(topIndex + 1).find((element) => !moving.has(element.id));
    if (!above) return result;
    const aboveIndex = ordered.indexOf(above);
    const beyond = ordered.slice(aboveIndex + 1).find((element) => !moving.has(element.id));
    const keys = keysBetween(above.z, beyond?.z ?? null, selected.length);
    selected.forEach((element, index) => result.set(element.id, keys[index]!));
    return result;
  }

  const bottomIndex = ordered.indexOf(selected[0]!);
  const below = ordered
    .slice(0, bottomIndex)
    .reverse()
    .find((element) => !moving.has(element.id));
  if (!below) return result;
  const belowIndex = ordered.indexOf(below);
  const beyond = ordered
    .slice(0, belowIndex)
    .reverse()
    .find((element) => !moving.has(element.id));
  const keys = keysBetween(beyond?.z ?? null, below.z, selected.length);
  selected.forEach((element, index) => result.set(element.id, keys[index]!));
  return result;
}
