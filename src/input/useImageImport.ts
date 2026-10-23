import { useEffect, type RefObject } from 'react';
import { screenToBoard } from '@/canvas/viewport';
import type { Point } from '@/geometry';
import { createElement } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { imageBlobsFrom, screenFitImageBox } from '@/media/images';
import { storeImage } from '@/media/storeImage';
import { importFile, isPdfFile, startImportBatch } from '@/importers/importFile';
import { boardDoc, useBoardStore } from '@/state/boardStore';

/**
 * Images arrive two ways, and both are browser-only APIs — which is exactly the part
 * that would have needed a separate native path had this stayed React Native.
 *
 *   paste  a `paste` event carrying image data from the system clipboard
 *   drop   a file dragged from the desktop onto the canvas
 *
 * Each image lands where it was dropped (or under the pointer when pasted), sized so
 * it is visible without swallowing the board.
 */
/** Space between pictures placed together. */
const IMAGE_GAP = 40;

export function useImageImport(hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let lastPointer: Point | null = null;

    const trackPointer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      lastPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const placeAt = async (blobs: Blob[], screenPoint: Point) => {
      // A viewer's paste would only be refused; do not upload anything for it.
      if (boardDoc().readOnly) return;
      const store = useBoardStore.getState();
      const centre = screenToBoard(store.viewport, screenPoint);
      // Several pictures at once go one under another, a gap apart: the first
      // centred where it landed, the rest below it, lined up on its left edge.
      let next: Point | null = null;

      for (const blob of blobs) {
        try {
          const imported = await storeImage(blob);
          const current = useBoardStore.getState();
          const box = screenFitImageBox(imported, current.stageSize.height);
          const at: Point = next ?? { x: centre.x - box.w / 2, y: centre.y - box.h / 2 };

          const element = createElement({
            type: 'image',
            box: { x: at.x, y: at.y, w: box.w, h: box.h },
            z: keyBetween(current.elements.at(-1)?.z ?? null, null),
          });
          element.image = imported;
          current.addElement(element);
          next = { x: at.x, y: at.y + box.h + IMAGE_GAP };
        } catch {
          // A file that will not decode is skipped; the rest still land.
        }
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'TEXTAREA')
      ) {
        return;
      }
      const blobs = imageBlobsFrom(event.clipboardData);
      if (blobs.length === 0) return;

      event.preventDefault();
      const centre = { x: host.clientWidth / 2, y: host.clientHeight / 2 };
      void placeAt(blobs, lastPointer ?? centre);
    };

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      // Without this the browser navigates away to the dropped file.
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      host.dataset.dropping = 'true';
    };

    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget && host.contains(event.relatedTarget as Node)) return;
      delete host.dataset.dropping;
    };

    const onDrop = (event: DragEvent) => {
      delete host.dataset.dropping;
      // A PDF becomes its pages; an SVG dropped stays a picture (import makes it shapes).
      const pdf = [...(event.dataTransfer?.files ?? [])].find(isPdfFile);
      if (pdf) {
        event.preventDefault();
        startImportBatch();
        void importFile(pdf);
        return;
      }
      const blobs = imageBlobsFrom(event.dataTransfer);
      if (blobs.length === 0) return;

      event.preventDefault();
      const rect = host.getBoundingClientRect();
      void placeAt(blobs, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };

    host.addEventListener('pointermove', trackPointer);
    window.addEventListener('paste', onPaste);
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);

    return () => {
      host.removeEventListener('pointermove', trackPointer);
      window.removeEventListener('paste', onPaste);
      host.removeEventListener('dragover', onDragOver);
      host.removeEventListener('dragleave', onDragLeave);
      host.removeEventListener('drop', onDrop);
    };
  }, [hostRef]);
}
