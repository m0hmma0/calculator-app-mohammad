import { useEffect, type RefObject } from 'react';
import { useBoardAccess } from '@/sharing/boardAccess';
import { screenToBoard } from '@/canvas/viewport';
import type { Point } from '@/geometry';
import { asUrl, placeLink } from '@/media/embeds';
import { copiesOf } from '@/model/copies';
import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';

const MIME = 'application/x-sabboura+json';
const FALLBACK_KEY = 'sabboura:clipboard';
const PASTE_OFFSET = 24;

interface Payload {
  kind: 'sabboura/elements';
  version: 1;
  elements: BoardElement[];
}

function encode(elements: readonly BoardElement[]): string {
  const payload: Payload = { kind: 'sabboura/elements', version: 1, elements: [...elements] };
  return JSON.stringify(payload);
}

function decode(text: string): BoardElement[] | null {
  try {
    const payload = JSON.parse(text) as Payload;
    if (payload?.kind !== 'sabboura/elements' || !Array.isArray(payload.elements)) return null;
    return payload.elements;
  } catch {
    return null;
  }
}

/**
 * Copy and paste through the real clipboard, so it works between two tabs of the
 * board — and, because the payload rides along as plain text, into anything else
 * as a readable blob rather than nothing at all.
 *
 * localStorage is a fallback for the cases where reading clipboard data is refused.
 */
export function useClipboard(hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let lastPointer: Point | null = null;
    const trackPointer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      lastPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT');

    const selectedElements = (): BoardElement[] => {
      const { elements, selection } = useBoardStore.getState();
      const ids = new Set(selection);
      return elements.filter(
        (element) => ids.has(element.id) || (element.parentId && ids.has(element.parentId)),
      );
    };

    const writeClipboard = (event: ClipboardEvent) => {
      const chosen = selectedElements();
      if (chosen.length === 0) return false;

      const text = encode(chosen);
      event.clipboardData?.setData('text/plain', text);
      event.clipboardData?.setData(MIME, text);
      try {
        localStorage.setItem(FALLBACK_KEY, text);
      } catch {
        // Private windows can refuse storage; the clipboard itself still carried it.
      }
      return true;
    };

    const onCopy = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;
      // Copying out is exporting, and the owner can switch that off for viewers.
      if (!useBoardAccess.getState().canExport) return;
      if (writeClipboard(event)) event.preventDefault();
    };

    const onCut = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;
      if (!writeClipboard(event)) return;
      event.preventDefault();
      useBoardStore.getState().deleteSelection();
    };

    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;

      const fromEvent =
        event.clipboardData?.getData(MIME) || event.clipboardData?.getData('text/plain') || '';
      let elements = decode(fromEvent);

      // A link becomes a video or a preview card rather than text.
      const link = elements ? null : asUrl(event.clipboardData?.getData('text/plain') ?? '');
      if (link) {
        event.preventDefault();
        const store = useBoardStore.getState();
        const centre = {
          x: store.viewport.x + store.stageSize.width / (2 * store.viewport.zoom),
          y: store.viewport.y + store.stageSize.height / (2 * store.viewport.zoom),
        };
        placeLink(link, lastPointer ? screenToBoard(store.viewport, lastPointer) : centre);
        return;
      }

      if (!elements) {
        try {
          elements = decode(localStorage.getItem(FALLBACK_KEY) ?? '');
        } catch {
          elements = null;
        }
      }
      if (!elements || elements.length === 0) return; // an image paste is handled elsewhere

      event.preventDefault();
      const store = useBoardStore.getState();

      // Land the copy under the pointer, keeping the group's internal arrangement.
      const minX = Math.min(...elements.map((element) => element.x));
      const minY = Math.min(...elements.map((element) => element.y));
      const target = lastPointer
        ? screenToBoard(store.viewport, lastPointer)
        : { x: minX + PASTE_OFFSET, y: minY + PASTE_OFFSET };

      const copies = copiesOf(elements, target, store.elements.at(-1)?.z ?? null);

      // Only the copies are written: rewriting the page would trample anyone editing it.
      store.addElements(copies);
    };

    host.addEventListener('pointermove', trackPointer);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);

    return () => {
      host.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
    };
  }, [hostRef]);
}
