import getStroke from 'perfect-freehand';
import { expandRect, type Rect } from '@/geometry';
import { fromFlat } from '@/ink/stroke';
import { elementAABB } from '@/model/bounds';
import type { BoardElement } from '@/model/element';
import { lineEnds, polygonPoints, POLYGONAL } from '@/model/shapePath';
import { fontStack } from '@/canvas/fonts';
import { detectDirection, wrapText } from '@/model/textLayout';

/** Colour tokens resolved to literal values, since SVG has no access to the page. */
export type ColorResolver = (value: string | null) => string | null;

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const round = (value: number): string => String(Math.round(value * 100) / 100);

const DASH_ARRAYS: Record<string, (width: number) => string> = {
  solid: () => '',
  dashed: (width) => `${width * 5} ${width * 3.5}`,
  dotted: (width) => `${width * 0.5} ${width * 2.5}`,
};

function paintAttributes(element: BoardElement, resolve: ColorResolver): string {
  const fill = resolve(element.style.fill);
  const stroke = resolve(element.style.stroke);
  const parts = [`fill="${fill ?? 'none'}"`];

  if (stroke && element.style.strokeWidth > 0) {
    parts.push(`stroke="${stroke}"`, `stroke-width="${round(element.style.strokeWidth)}"`);
    const dash = DASH_ARRAYS[element.style.dash]?.(element.style.strokeWidth);
    if (dash) parts.push(`stroke-dasharray="${dash}"`);
    parts.push('stroke-linecap="round"', 'stroke-linejoin="round"');
  }
  if (element.opacity !== 1) parts.push(`opacity="${round(element.opacity)}"`);
  return parts.join(' ');
}

function transformAttribute(element: BoardElement): string {
  if (element.rotation === 0) return '';
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const degrees = (element.rotation * 180) / Math.PI;
  return ` transform="rotate(${round(degrees)} ${round(cx)} ${round(cy)})"`;
}

function textElement(element: BoardElement, resolve: ColorResolver): string {
  const content = element.text ?? '';
  if (content.trim() === '') return '';

  const style = element.style;
  const colour = resolve(style.textColor ?? style.fill) ?? '#000000';
  const direction = detectDirection(content);
  // Without a text measurer, approximate width per character — enough to place
  // line breaks close to where the canvas put them.
  const approximate = (text: string) => text.length * style.fontSize * 0.54;
  const lines = wrapText(content, Math.max(1, element.w), approximate, style);
  const lineHeight = style.fontSize * style.lineHeight;

  const anchor = style.align === 'center' ? 'middle' : style.align === 'end' ? 'end' : 'start';
  const x =
    style.align === 'center'
      ? element.x + element.w / 2
      : style.align === 'end'
        ? element.x + element.w
        : element.x;

  const rows = lines
    .map((line, index) => {
      const y = element.y + index * lineHeight + style.fontSize * 0.85;
      return `<tspan x="${round(x)}" y="${round(y)}">${escapeXml(line.marker + line.text)}</tspan>`;
    })
    .join('');

  const decoration = style.underline ? ' text-decoration="underline"' : '';
  const italic = style.italic ? ' font-style="italic"' : '';

  return `<text font-family="${escapeXml(fontStack(style.fontFamily))}" font-size="${round(style.fontSize)}" font-weight="${style.fontWeight}"${italic} fill="${colour}" text-anchor="${anchor}" direction="${direction}"${decoration}${transformAttribute(element)}>${rows}</text>`;
}

function shapeElement(element: BoardElement, resolve: ColorResolver): string {
  const paint = paintAttributes(element, resolve);
  const transform = transformAttribute(element);

  switch (element.type) {
    case 'ellipse':
      return `<ellipse cx="${round(element.x + element.w / 2)}" cy="${round(element.y + element.h / 2)}" rx="${round(element.w / 2)}" ry="${round(element.h / 2)}" ${paint}${transform}/>`;

    case 'line':
    case 'arrow': {
      const [start, end] = lineEnds(element);
      const from = { x: element.x + start.x, y: element.y + start.y };
      const to = { x: element.x + end.x, y: element.y + end.y };
      const line = `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" y2="${round(to.y)}" ${paint}${transform}/>`;
      if (element.type === 'line') return line;

      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const size = Math.min(14, Math.hypot(element.w, element.h) * 0.4);
      const wing = (spread: number) =>
        `${round(to.x + Math.cos(angle + spread) * size)},${round(to.y + Math.sin(angle + spread) * size)}`;
      const head = `<polyline points="${wing(Math.PI * 0.82)} ${round(to.x)},${round(to.y)} ${wing(-Math.PI * 0.82)}" fill="none" stroke="${resolve(element.style.stroke) ?? '#000'}" stroke-width="${round(element.style.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"${transform}/>`;
      return line + head;
    }

    case 'path': {
      const outline = getStroke(
        fromFlat(element.points ?? []).map((point) => [point.x, point.y, point.pressure]),
        {
          size: element.style.strokeWidth,
          thinning: 0.55,
          smoothing: 0.55,
          streamline: 0.4,
          simulatePressure: false,
          last: true,
        },
      ) as number[][];
      if (outline.length < 3) return '';
      const d = outline
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${round(element.x + point[0]!)},${round(element.y + point[1]!)}`,
        )
        .join('');
      const fill = resolve(element.style.fill ?? element.style.stroke) ?? '#000';
      return `<path d="${d}Z" fill="${fill}"${element.opacity !== 1 ? ` opacity="${round(element.opacity)}"` : ''}${transform}/>`;
    }

    case 'image': {
      const source = element.image?.src;
      if (!source) return '';
      return `<image href="${escapeXml(source)}" x="${round(element.x)}" y="${round(element.y)}" width="${round(element.w)}" height="${round(element.h)}" preserveAspectRatio="none"${transform}/>`;
    }

    case 'sticky':
    case 'frame': {
      const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
      const box = `<rect x="${round(element.x)}" y="${round(element.y)}" width="${round(element.w)}" height="${round(element.h)}" rx="${round(radius)}" ${paint}${transform}/>`;
      return element.type === 'sticky' ? box + textElement(element, resolve) : box;
    }

    case 'text':
      return textElement(element, resolve);

    default: {
      if (POLYGONAL.has(element.type)) {
        const points = polygonPoints(element)
          .map((point) => `${round(element.x + point.x)},${round(element.y + point.y)}`)
          .join(' ');
        return `<polygon points="${points}" ${paint}${transform}/>`;
      }
      const radius = Math.min(element.style.radius, element.w / 2, element.h / 2);
      return `<rect x="${round(element.x)}" y="${round(element.y)}" width="${round(element.w)}" height="${round(element.h)}" rx="${round(radius)}" ${paint}${transform}/>`;
    }
  }
}

export interface SvgOptions {
  resolve: ColorResolver;
  background?: string | null;
  padding?: number;
}

/**
 * A real vector export: shapes stay shapes and text stays selectable, rather than a
 * bitmap in an SVG wrapper.
 */
export function elementsToSvg(elements: readonly BoardElement[], options: SvgOptions): string {
  const visible = elements.filter((element) => !element.hidden && element.type !== 'group');
  const bounds = boundsOf(visible, options.padding ?? 24);

  const body = visible.map((element) => shapeElement(element, options.resolve)).join('');
  const background = options.background
    ? `<rect x="${round(bounds.x)}" y="${round(bounds.y)}" width="${round(bounds.w)}" height="${round(bounds.h)}" fill="${options.background}"/>`
    : '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${round(bounds.w)}" height="${round(bounds.h)}" viewBox="${round(bounds.x)} ${round(bounds.y)} ${round(bounds.w)} ${round(bounds.h)}">`,
    background,
    body,
    '</svg>',
  ].join('');
}

export function boundsOf(elements: readonly BoardElement[], padding = 24): Rect {
  if (elements.length === 0) return { x: 0, y: 0, w: 1, h: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const box = elementAABB(element);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  return expandRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, padding);
}
