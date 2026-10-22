import type { Rect } from '@/geometry';
import { createElement, type BoardElement, type ElementStyle } from '@/model/element';

/**
 * An SVG file brought in as shapes that can be edited one by one, rather than as a
 * picture. Rectangles, circles, ellipses, lines and text map onto their board
 * counterparts; paths, polylines and polygons become ink that follows the outline.
 * Gradients, patterns, clip paths and filters have no counterpart and are dropped,
 * and a path's fill is not kept — it becomes its outline.
 *
 * The browser does the geometry: the file is mounted out of sight so every element's
 * transform, inherited style and path length can be asked for rather than parsed.
 */

/** Ink samples along a path, in user units. */
const SAMPLE_STEP = 3;
const MAX_SAMPLES = 1500;
const MAX_ELEMENTS = 2000;
const INK_PRESSURE = 0.5;

/** Drawing elements; everything else is walked through or skipped. */
const SHAPES = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
]);
/** Content that is never drawn directly, or cannot be represented at all. */
const SKIP = new Set([
  'defs',
  'clipPath',
  'mask',
  'pattern',
  'symbol',
  'marker',
  'linearGradient',
  'radialGradient',
  'filter',
  'script',
  'style',
  'title',
  'desc',
  'metadata',
  'foreignObject',
  'image',
]);

export class SvgImportError extends Error {}

/** A file from anywhere: nothing in it may run. */
function sanitize(root: Element): void {
  for (const node of [...root.querySelectorAll('script, foreignObject, iframe')]) node.remove();
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attribute.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) {
        node.removeAttribute(attribute.name);
      }
    }
  }
}

function toHex(color: string): string | null {
  if (!color || color === 'none' || color === 'transparent') return null;
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(color);
  if (!rgb) return color.startsWith('url(') ? null : color;
  const alpha = rgb[4] === undefined ? 1 : parseFloat(rgb[4]) / (rgb[4].endsWith('%') ? 100 : 1);
  if (alpha === 0) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

function transformPoint(matrix: DOMMatrix, x: number, y: number) {
  const point = new DOMPoint(x, y).matrixTransform(matrix);
  return { x: point.x, y: point.y };
}

/** A box in user space, as a board box — valid when the matrix only moves and scales. */
function transformBox(matrix: DOMMatrix, user: DOMRect): Rect {
  const box = { x: user.x, y: user.y, w: user.width, h: user.height };
  const a = transformPoint(matrix, box.x, box.y);
  const b = transformPoint(matrix, box.x + box.w, box.y + box.h);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

const isAxisAligned = (matrix: DOMMatrix) => Math.abs(matrix.b) < 1e-6 && Math.abs(matrix.c) < 1e-6;
const scaleOf = (matrix: DOMMatrix) =>
  Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));

/**
 * Points along a shape's outline, in runs — a path with several pieces (a letter
 * "i", a ring) jumps between them, and each jump starts a new run.
 */
function sampleOutline(shape: SVGGeometryElement, matrix: DOMMatrix): { x: number; y: number }[][] {
  let total: number;
  try {
    total = shape.getTotalLength();
  } catch {
    return [];
  }
  if (!(total > 0)) return [];
  const step = Math.max(SAMPLE_STEP, total / MAX_SAMPLES);
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  let previous: DOMPoint | null = null;
  for (let at = 0; at <= total + step / 2; at += step) {
    const point = shape.getPointAtLength(Math.min(at, total));
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > step * 2 + 1) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(transformPoint(matrix, point.x, point.y));
    previous = point;
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function inkFrom(
  run: { x: number; y: number }[],
  color: string,
  width: number,
  closed: boolean,
): BoardElement {
  const points = closed ? [...run, run[0]!] : run;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const element = createElement({
    type: 'path',
    box: { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
    z: 'a0',
    style: { fill: color, stroke: null, strokeWidth: Math.max(1, width) },
  });
  element.points = points.flatMap((point) => [point.x - minX, point.y - minY, INK_PRESSURE]);
  return element;
}

function convert(shape: SVGGraphicsElement): BoardElement[] {
  const tag = shape.localName;
  const style = getComputedStyle(shape);
  if (style.display === 'none' || style.visibility === 'hidden') return [];
  const matrix = shape.getCTM();
  if (!matrix) return [];
  const scale = scaleOf(matrix);
  const fill = toHex(style.fill);
  const stroke = toHex(style.stroke);
  const strokeWidth = (parseFloat(style.strokeWidth) || 1) * scale;
  const opacity = Number(style.opacity) || 1;
  const withOpacity = (element: BoardElement) => ({ ...element, opacity });

  if (tag === 'text') {
    const text = shape.textContent?.replace(/\s+/g, ' ').trim();
    if (!text || !isAxisAligned(matrix)) return [];
    const box = transformBox(matrix, (shape as SVGTextElement).getBBox());
    const element = createElement({
      type: 'text',
      box: { ...box, w: box.w * 1.1 + 4, h: box.h },
      z: 'a0',
      style: {
        fill: null,
        stroke: null,
        textColor: fill ?? '#000000',
        fontSize: Math.max(6, Math.round((parseFloat(style.fontSize) || 16) * scale)),
        fontWeight: Number(style.fontWeight) || 400,
        italic: style.fontStyle === 'italic',
      } satisfies Partial<ElementStyle>,
    });
    element.text = text;
    return [withOpacity(element)];
  }

  const geometry = shape as SVGGeometryElement;
  const simple = isAxisAligned(matrix) && (tag === 'rect' || tag === 'circle' || tag === 'ellipse');
  if (simple) {
    const box = transformBox(matrix, geometry.getBBox());
    if (box.w <= 0 || box.h <= 0 || (!fill && !stroke)) return [];
    const rx = tag === 'rect' ? (parseFloat(shape.getAttribute('rx') ?? '') || 0) * scale : 0;
    const element = createElement({
      type: tag === 'rect' ? 'rect' : 'ellipse',
      box,
      z: 'a0',
      style: {
        fill,
        stroke,
        strokeWidth: stroke ? strokeWidth : 0,
        radius: rx,
      },
    });
    return [withOpacity(element)];
  }

  if (tag === 'line' && isAxisAligned(matrix)) {
    const read = (name: string) => parseFloat(shape.getAttribute(name) ?? '0') || 0;
    const a = transformPoint(matrix, read('x1'), read('y1'));
    const b = transformPoint(matrix, read('x2'), read('y2'));
    if (!stroke) return [];
    const element = createElement({
      type: 'line',
      box: {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      },
      z: 'a0',
      style: {
        stroke,
        strokeWidth,
        // The line runs bottom-left to top-right when one end is above and right of the other.
        flipX: (b.x - a.x) * (b.y - a.y) < 0,
        reverse: b.x < a.x || (b.x === a.x && b.y < a.y),
      },
    });
    return [withOpacity(element)];
  }

  // Everything else follows its outline in ink: the stroke if there is one, else
  // the edge of the fill.
  const color = stroke ?? fill;
  if (!color) return [];
  const closed = tag === 'polygon' || tag === 'rect' || tag === 'circle' || tag === 'ellipse';
  return sampleOutline(geometry, matrix).map((run) =>
    withOpacity(inkFrom(run, color, stroke ? strokeWidth : 2 * scale, closed)),
  );
}

/** Reads an SVG file into board elements, grouped, with their top-left at the origin. */
export function svgToElements(source: string): BoardElement[] {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new SvgImportError('That file is not an SVG this can read.');
  }
  sanitize(root);

  // Mounted, but out of sight and out of reach, so the browser lays it out.
  const host = document.createElement('div');
  // Not `visibility: hidden` — it is inherited, and would read as every shape hidden.
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  // Without a size of its own, an SVG takes its container's — here, none at all.
  const viewBox = svg.viewBox.baseVal;
  if (!svg.getAttribute('width') && viewBox?.width) svg.setAttribute('width', `${viewBox.width}`);
  if (!svg.getAttribute('height') && viewBox?.height) {
    svg.setAttribute('height', `${viewBox.height}`);
  }
  host.appendChild(svg);
  document.body.appendChild(host);

  const elements: BoardElement[] = [];
  try {
    const walk = (node: Element) => {
      for (const child of node.children) {
        if (elements.length >= MAX_ELEMENTS) return;
        if (SKIP.has(child.localName)) continue;
        if (SHAPES.has(child.localName)) {
          elements.push(...convert(child as SVGGraphicsElement));
        } else {
          walk(child);
        }
      }
    };
    walk(svg);
  } finally {
    host.remove();
  }
  if (elements.length === 0)
    throw new SvgImportError('Nothing in that SVG could be turned into shapes.');

  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  for (const element of elements) {
    element.x -= minX;
    element.y -= minY;
  }
  if (elements.length === 1) return elements;

  // One group, so the drawing moves as a whole until someone takes it apart.
  const maxX = Math.max(...elements.map((element) => element.x + element.w));
  const maxY = Math.max(...elements.map((element) => element.y + element.h));
  const group = createElement({ type: 'group', box: { x: 0, y: 0, w: maxX, h: maxY }, z: 'a0' });
  return [...elements.map((element) => ({ ...element, parentId: group.id })), group];
}
