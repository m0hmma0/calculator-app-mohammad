import type { TextMark } from '@/model/element';
import { marksFromDelta, runsOf, type MarkSet } from './marks';

/**
 * The bridge between a text with formatting and the editable box showing it. The
 * box is built from spans, one per run of formatting, holding the text with its
 * line breaks as "\n" (the box keeps them with `white-space: pre-wrap`). Reading it
 * back walks the same structure, so positions in the text and positions in the box
 * always agree — including after the browser has edited it in its own way.
 */

const TAIL = 'data-tail';

/**
 * Colours, highlights and links are kept in data attributes, read back exactly as
 * written: a browser rewrites an inline colour (`#e03131` comes back as
 * `rgb(224, 49, 49)`), and a box that never reads back what it was given would be
 * redrawn after every keystroke.
 */
const VALUE_ATTRIBUTE = { color: 'data-color', highlight: 'data-highlight', link: 'data-link' };

/** Fills the box with the text, formatted. */
export function renderInto(root: HTMLElement, text: string, marks: readonly TextMark[] = []): void {
  const nodes: Node[] = [];
  for (const run of runsOf(marks, 0, text.length)) {
    const piece = document.createTextNode(text.slice(run.from, run.to));
    const { bold, italic, underline, color, highlight, link } = run.marks;
    if (!bold && !italic && !underline && !color && !highlight && !link) {
      nodes.push(piece);
      continue;
    }
    const span = document.createElement('span');
    if (bold) span.style.fontWeight = '700';
    if (italic) span.style.fontStyle = 'italic';
    if (underline) span.style.textDecoration = 'underline';
    if (color) {
      span.setAttribute(VALUE_ATTRIBUTE.color, color);
      span.style.color = color;
    }
    if (highlight) {
      span.setAttribute(VALUE_ATTRIBUTE.highlight, highlight);
      span.style.backgroundColor = highlightPaint(highlight);
    }
    // A link's own look (colour, underline) comes from the editor's stylesheet.
    if (link) span.setAttribute(VALUE_ATTRIBUTE.link, link);
    span.append(piece);
    nodes.push(span);
  }
  // An empty box, or one ending on a new line, needs something for the caret to
  // stand on; this break is not part of the text.
  if (text === '' || text.endsWith('\n')) {
    const tail = document.createElement('br');
    tail.setAttribute(TAIL, '');
    nodes.push(tail);
  }
  root.replaceChildren(...nodes);
}

/**
 * A highlight behind words, as the editor paints it: the colour itself on a light
 * theme, toned down on a dark one (the stylesheet sets how far), so light words stay
 * readable on it.
 */
export function highlightPaint(colour: string): string {
  return `color-mix(in srgb, ${colour} var(--highlight-mix, 100%), transparent)`;
}

function formattingOf(element: Element, inherited: MarkSet): MarkSet {
  const own: MarkSet = { ...inherited };
  const tag = element.tagName;
  const style = (element as HTMLElement).style;
  if (tag === 'B' || tag === 'STRONG' || Number(style?.fontWeight) >= 600) own.bold = true;
  if (style?.fontWeight === 'bold') own.bold = true;
  if (tag === 'I' || tag === 'EM' || style?.fontStyle === 'italic') own.italic = true;
  if (tag === 'U' || style?.textDecoration?.includes('underline')) own.underline = true;
  for (const [name, attribute] of Object.entries(VALUE_ATTRIBUTE) as Array<
    [keyof typeof VALUE_ATTRIBUTE, string]
  >) {
    const value = element.getAttribute(attribute);
    if (value) own[name] = value;
  }
  if (tag === 'A' && element.getAttribute('href')) own.link = element.getAttribute('href')!;
  return own;
}

const BLOCKS = new Set(['DIV', 'P', 'LI']);

interface Piece {
  /** A text node, or the element a line break comes from. */
  node: Node;
  start: number;
  length: number;
}

/** The text in the box, its formatting, and where each piece of it sits. */
export function readBox(root: HTMLElement): { text: string; marks: TextMark[]; pieces: Piece[] } {
  let text = '';
  const pieces: Piece[] = [];
  const delta: Array<{ insert: string; attributes?: Record<string, string | boolean> }> = [];
  const add = (value: string, marks: MarkSet, node: Node) => {
    pieces.push({ node, start: text.length, length: value.length });
    text += value;
    const attributes: Record<string, string | boolean> = {};
    if (marks.bold) attributes.bold = true;
    if (marks.italic) attributes.italic = true;
    if (marks.underline) attributes.underline = true;
    if (marks.color) attributes.color = marks.color;
    if (marks.highlight) attributes.highlight = marks.highlight;
    if (marks.link) attributes.link = marks.link;
    delta.push(Object.keys(attributes).length ? { insert: value, attributes } : { insert: value });
  };
  const walk = (node: Node, marks: MarkSet) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        add((child as Text).data, marks, child);
      } else if (child instanceof HTMLBRElement) {
        if (!child.hasAttribute(TAIL)) add('\n', marks, child);
      } else if (child instanceof Element) {
        // A browser that wraps a line in its own block: a new line before it.
        if (BLOCKS.has(child.tagName) && text !== '' && !text.endsWith('\n')) {
          add('\n', marks, child);
        }
        walk(child, formattingOf(child, marks));
      }
    }
  };
  walk(root, {});
  return { text, marks: marksFromDelta(delta), pieces };
}

/** Where a point in the box is, as a position in the text. */
export function offsetAt(root: HTMLElement, container: Node, offset: number): number {
  const { pieces, text } = readBox(root);
  if (container.nodeType === Node.TEXT_NODE) {
    const piece = pieces.find((each) => each.node === container);
    return piece ? piece.start + Math.min(offset, piece.length) : text.length;
  }
  // A point between children: everything in the children before it comes first.
  const before = container.childNodes[offset];
  if (!before) {
    // After the last child of `container`: the end of whatever it holds.
    let end = container === root ? text.length : 0;
    for (const piece of pieces) {
      if (container.contains(piece.node)) end = piece.start + piece.length;
    }
    return end;
  }
  for (const piece of pieces) {
    if (piece.node === before || before.contains(piece.node)) return piece.start;
    if (before.compareDocumentPosition(piece.node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return piece.start;
    }
  }
  return text.length;
}

/** The selection in the box, as positions in the text; null if it is elsewhere. */
export function selectionIn(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetAt(root, range.startContainer, range.startOffset),
    end: offsetAt(root, range.endContainer, range.endOffset),
  };
}

/** A position in the text, as a point in the box. */
function pointAt(root: HTMLElement, position: number): { node: Node; offset: number } {
  const { pieces } = readBox(root);
  for (const piece of pieces) {
    if (position > piece.start + piece.length) continue;
    if (piece.node.nodeType === Node.TEXT_NODE) {
      return { node: piece.node, offset: position - piece.start };
    }
    // A line break: before it, or — at its far side — just after it.
    const parent = piece.node.parentNode!;
    const index = Array.prototype.indexOf.call(parent.childNodes, piece.node) as number;
    if (position === piece.start) return { node: parent, offset: index };
    if (position === piece.start + piece.length) return { node: parent, offset: index + 1 };
  }
  // The end: before the trailing break, if there is one.
  const tail = root.querySelector(`br[${TAIL}]`);
  if (tail) {
    const parent = tail.parentNode!;
    return {
      node: parent,
      offset: Array.prototype.indexOf.call(parent.childNodes, tail) as number,
    };
  }
  return { node: root, offset: root.childNodes.length };
}

export function selectRange(root: HTMLElement, start: number, end: number): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const from = pointAt(root, start);
  const to = pointAt(root, end);
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}
