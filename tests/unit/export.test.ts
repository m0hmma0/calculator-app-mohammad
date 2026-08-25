import { describe, expect, it } from 'vitest';
import { jpegToPdf } from '@/export/pdf';
import { boundsOf, elementsToSvg } from '@/export/svg';
import { createElement, type BoardElement } from '@/model/element';

const resolve = (value: string | null) =>
  value === null ? null : value.replace(/var\(--(.+)\)/, '#$1');

const make = (type: BoardElement['type'], overrides: Partial<BoardElement> = {}): BoardElement => ({
  ...createElement({ type, box: { x: 100, y: 100, w: 80, h: 60 }, z: 'a0' }),
  ...overrides,
});

describe('boundsOf', () => {
  it('wraps everything with padding', () => {
    const bounds = boundsOf([make('rect'), make('rect', { x: 300, y: 400 })], 10);
    expect(bounds.x).toBe(90);
    expect(bounds.y).toBe(90);
    expect(bounds.w).toBe(300);
    expect(bounds.h).toBe(380);
  });

  it('survives an empty board', () => {
    expect(boundsOf([], 10).w).toBeGreaterThan(0);
  });

  it('accounts for rotation', () => {
    const rotated = make('rect', { rotation: Math.PI / 4 });
    expect(boundsOf([rotated], 0).w).toBeGreaterThan(80);
  });
});

// Checklist item 8.
describe('SVG export', () => {
  it('produces a document with real geometry, not a bitmap', () => {
    const svg = elementsToSvg([make('rect'), make('ellipse', { x: 300 })], { resolve });

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<ellipse');
    expect(svg).not.toContain('data:image/png');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('writes a viewBox that matches the content', () => {
    const svg = elementsToSvg([make('rect')], { resolve, padding: 10 });
    expect(svg).toContain('viewBox="90 90 100 80"');
    expect(svg).toContain('width="100"');
  });

  it('emits each shape family with its own element', () => {
    const svg = elementsToSvg(
      [
        make('triangle', { x: 0 }),
        make('line', { x: 200 }),
        make('arrow', { x: 400 }),
        make('text', { x: 600, text: 'hello' }),
      ],
      { resolve },
    );
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<line');
    expect(svg).toContain('<polyline'); // the arrowhead
    expect(svg).toContain('<text');
    expect(svg).toContain('hello');
  });

  it('keeps text selectable rather than converting it to paths', () => {
    const svg = elementsToSvg([make('text', { text: 'Selectable', w: 400 })], { resolve });
    expect(svg).toContain('>Selectable<');
    expect(svg).toContain('font-size=');
    expect(svg).not.toContain('<path');
  });

  it('wraps text that does not fit its box', () => {
    // The box is 80 wide, so this cannot sit on one line.
    const svg = elementsToSvg([make('text', { text: 'Selectable' })], { resolve });
    expect((svg.match(/<tspan/g) ?? []).length).toBeGreaterThan(1);
  });

  it('marks Arabic text as right to left', () => {
    const svg = elementsToSvg([make('text', { text: 'مرحبا' })], { resolve });
    expect(svg).toContain('direction="rtl"');
  });

  it('escapes characters that would break the XML', () => {
    const svg = elementsToSvg([make('text', { text: 'a < b & c > d "q"' })], { resolve });
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toMatch(/>a < b/);
  });

  it('skips hidden elements and groups', () => {
    const svg = elementsToSvg([make('rect', { hidden: true }), make('group', { x: 400 })], {
      resolve,
    });
    expect(svg).not.toContain('<rect x="100"');
  });

  it('omits a background unless asked for one', () => {
    expect(elementsToSvg([make('rect')], { resolve })).not.toContain('fill="#ffffff"');
    expect(elementsToSvg([make('rect')], { resolve, background: '#ffffff' })).toContain('#ffffff');
  });

  it('carries rotation as a transform', () => {
    const svg = elementsToSvg([make('rect', { rotation: Math.PI / 2 })], { resolve });
    expect(svg).toContain('transform="rotate(90');
  });

  it('embeds an image by reference', () => {
    const svg = elementsToSvg(
      [
        make('image', {
          image: { src: 'data:image/png;base64,AAAA', naturalWidth: 2, naturalHeight: 2 },
        }),
      ],
      { resolve },
    );
    expect(svg).toContain('<image');
    expect(svg).toContain('data:image/png;base64,AAAA');
  });

  it('renders ink as a filled outline path', () => {
    const svg = elementsToSvg([make('path', { points: [0, 0, 0.5, 20, 10, 0.6, 40, 0, 0.5] })], {
      resolve,
    });
    expect(svg).toContain('<path d="M');
  });
});

describe('PDF export', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
  const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

  it('writes a file a reader will recognise', () => {
    const pdf = jpegToPdf({ jpeg, widthPx: 400, heightPx: 300 });
    const body = text(pdf);
    expect(body.startsWith('%PDF-1.4')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('declares one page holding the image', () => {
    const body = text(jpegToPdf({ jpeg, widthPx: 400, heightPx: 300 }));
    expect(body).toContain('/Type /Catalog');
    expect(body).toContain('/Count 1');
    expect(body).toContain('/Filter /DCTDecode');
    expect(body).toContain('/Width 400');
    expect(body).toContain('/Height 300');
  });

  it('sizes the page in points, not pixels', () => {
    // 96px at 96dpi is one inch, which is 72 points.
    const body = text(jpegToPdf({ jpeg, widthPx: 96, heightPx: 96 }));
    expect(body).toContain('/MediaBox [0 0 72 72]');
  });

  it('includes the image bytes verbatim', () => {
    const pdf = jpegToPdf({ jpeg, widthPx: 10, heightPx: 10 });
    const needle = text(jpeg);
    expect(text(pdf)).toContain(needle);
    expect(text(pdf)).toContain(`/Length ${jpeg.length}`);
  });

  it('points the cross-reference table at a real offset', () => {
    const pdf = jpegToPdf({ jpeg, widthPx: 10, heightPx: 10 });
    const body = text(pdf);
    const start = Number(/startxref\n(\d+)/.exec(body)![1]);
    expect(start).toBeGreaterThan(0);
    expect(body.slice(start, start + 4)).toBe('xref');
  });
});
