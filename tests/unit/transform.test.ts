import { describe, expect, it } from 'vitest';
import { elementCorners, elementAABB, localToWorld, worldToLocal } from '@/model/bounds';
import { createElement, type BoardElement } from '@/model/element';
import {
  cursorForHandle,
  degreesOf,
  handleSign,
  HANDLES,
  isCornerHandle,
  normaliseAngle,
  resizeBox,
  ROTATION_STEP,
  scaleBoxInto,
  snapRotation,
  type HandleId,
} from '@/model/transform';

function shape(overrides: Partial<BoardElement> = {}): BoardElement {
  return {
    ...createElement({ type: 'rect', box: { x: 100, y: 100, w: 200, h: 100 }, z: 'a0' }),
    ...overrides,
  };
}

/** The corner (or edge midpoint) opposite the one being dragged. */
function anchorPoint(element: BoardElement, handle: HandleId) {
  const { sx, sy } = handleSign(handle);
  return localToWorld(element, {
    x: element.w / 2 - (sx * element.w) / 2,
    y: element.h / 2 - (sy * element.h) / 2,
  });
}

describe('resizeBox', () => {
  const rotations = [0, Math.PI / 6, Math.PI / 2, (3 * Math.PI) / 4, -Math.PI / 3];

  it('holds the opposite corner still at every rotation', () => {
    for (const rotation of rotations) {
      for (const handle of HANDLES) {
        const element = shape({ rotation });
        const before = anchorPoint(element, handle);

        const pointer = { x: 420, y: 380 };
        const resized = { ...element, ...resizeBox(element, handle, pointer) };
        const after = anchorPoint(resized, handle);

        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
      }
    }
  });

  it('holds the centre still when growing from the centre', () => {
    for (const rotation of rotations) {
      for (const handle of HANDLES) {
        const element = shape({ rotation });
        const box = resizeBox(element, handle, { x: 400, y: 300 }, { fromCentre: true });

        expect(box.x + box.w / 2).toBeCloseTo(element.x + element.w / 2, 6);
        expect(box.y + box.h / 2).toBeCloseTo(element.y + element.h / 2, 6);
      }
    }
  });

  it('only moves the axis an edge handle owns', () => {
    const element = shape();
    const box = resizeBox(element, 'e', { x: 500, y: 999 });
    expect(box.h).toBe(element.h);
    expect(box.y).toBe(element.y);
    expect(box.w).toBeCloseTo(400, 6);
  });

  it('keeps the ratio when asked, and frees it when not', () => {
    const element = shape(); // 200 x 100, ratio 2
    const pointer = { x: 500, y: 250 };

    const free = resizeBox(element, 'se', pointer);
    expect(free.w / free.h).not.toBeCloseTo(2, 3);

    const locked = resizeBox(element, 'se', pointer, { lockAspect: true });
    expect(locked.w / locked.h).toBeCloseTo(2, 6);
  });

  it('leaves an edge handle unconstrained even with the ratio locked', () => {
    const element = shape();
    const box = resizeBox(element, 'e', { x: 500, y: 150 }, { lockAspect: true });
    expect(box.h).toBe(element.h);
  });

  it('refuses to invert when dragged past the anchor', () => {
    const element = shape();
    const box = resizeBox(element, 'e', { x: -1000, y: 150 });
    expect(box.w).toBeGreaterThan(0);
    expect(box.w).toBeLessThanOrEqual(1);
  });

  it('respects a caller-supplied minimum', () => {
    const box = resizeBox(shape(), 'se', { x: -500, y: -500 }, { minSize: 20 });
    expect(box.w).toBe(20);
    expect(box.h).toBe(20);
  });
});

describe('handles', () => {
  it('signs each handle', () => {
    expect(handleSign('nw')).toEqual({ sx: -1, sy: -1 });
    expect(handleSign('e')).toEqual({ sx: 1, sy: 0 });
    expect(handleSign('s')).toEqual({ sx: 0, sy: 1 });
  });

  it('knows corners from edges', () => {
    expect(isCornerHandle('ne')).toBe(true);
    expect(isCornerHandle('n')).toBe(false);
  });

  // Checklist item 4: the cursor has to match the edge you are actually over.
  it('picks the cursor from the handle direction', () => {
    expect(cursorForHandle('e', 0)).toBe('ew-resize');
    expect(cursorForHandle('w', 0)).toBe('ew-resize');
    expect(cursorForHandle('n', 0)).toBe('ns-resize');
    expect(cursorForHandle('se', 0)).toBe('nwse-resize');
    expect(cursorForHandle('ne', 0)).toBe('nesw-resize');
  });

  it('rotates the cursor with the element', () => {
    // Turn the shape 90° and the east edge now faces down.
    expect(cursorForHandle('e', Math.PI / 2)).toBe('ns-resize');
    expect(cursorForHandle('n', Math.PI / 2)).toBe('ew-resize');
    expect(cursorForHandle('se', Math.PI / 2)).toBe('nesw-resize');
  });
});

describe('rotation', () => {
  it('settles onto a 15° mark when close to one', () => {
    const justOff = ROTATION_STEP * 2 + 0.01;
    expect(snapRotation(justOff, false)).toBeCloseTo(ROTATION_STEP * 2, 6);
  });

  it('leaves a deliberate angle alone', () => {
    const between = ROTATION_STEP * 2 + ROTATION_STEP * 0.5;
    expect(snapRotation(between, false)).toBeCloseTo(between, 6);
  });

  it('allows only 15° steps when held hard', () => {
    for (const angle of [0.1, 0.6, 1.9, 5.5]) {
      const snapped = snapRotation(angle, true);
      const steps = snapped / ROTATION_STEP;
      expect(steps - Math.round(steps)).toBeCloseTo(0, 9);
    }
  });

  it('normalises into one turn', () => {
    expect(normaliseAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 9);
    expect(normaliseAngle(Math.PI * 5)).toBeCloseTo(Math.PI, 9);
  });

  it('reports whole degrees for the readout', () => {
    expect(degreesOf(0)).toBe(0);
    expect(degreesOf(Math.PI / 2)).toBe(90);
    expect(degreesOf(-Math.PI / 2)).toBe(270);
  });
});

describe('bounds', () => {
  it('round-trips local and world coordinates under rotation', () => {
    const element = shape({ rotation: 0.7 });
    const local = { x: 42, y: 17 };
    const back = worldToLocal(element, localToWorld(element, local));
    expect(back.x).toBeCloseTo(local.x, 6);
    expect(back.y).toBeCloseTo(local.y, 6);
  });

  it('leaves the box alone when unrotated', () => {
    const element = shape();
    expect(elementAABB(element)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it('grows the axis-aligned box when rotated', () => {
    const element = shape({ rotation: Math.PI / 4 });
    const aabb = elementAABB(element);
    expect(aabb.w).toBeGreaterThan(element.w);
    expect(aabb.h).toBeGreaterThan(element.h);
    // Rotating about the centre must not move the centre.
    expect(aabb.x + aabb.w / 2).toBeCloseTo(element.x + element.w / 2, 6);
  });

  it('returns four corners that keep the diagonal length', () => {
    const element = shape({ rotation: 1.1 });
    const [tl, , br] = elementCorners(element);
    expect(Math.hypot(br.x - tl.x, br.y - tl.y)).toBeCloseTo(Math.hypot(element.w, element.h), 6);
  });
});

describe('scaleBoxInto', () => {
  it('maps a child box proportionally as the parent grows', () => {
    const from = { x: 0, y: 0, w: 100, h: 100 };
    const to = { x: 50, y: 50, w: 200, h: 300 };
    expect(scaleBoxInto({ x: 50, y: 50, w: 25, h: 10 }, from, to)).toEqual({
      x: 150,
      y: 200,
      w: 50,
      h: 30,
    });
  });

  it('survives a zero-width source', () => {
    const box = scaleBoxInto(
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 0, h: 100 },
      { x: 0, y: 0, w: 50, h: 200 },
    );
    expect(Number.isFinite(box.w)).toBe(true);
  });
});
