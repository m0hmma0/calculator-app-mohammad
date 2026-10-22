import { useEffect, type RefObject } from 'react';
import { screenToBoard } from '@/canvas/viewport';
import type { Point } from '@/geometry';
import { createElement } from '@/model/element';
import { keyBetween } from '@/model/zorder';
import { fileUrl } from '@shared/files';
import { blobToDataUrl, imageBlobsFrom, initialImageBox, prepareImage } from '@/media/images';
import { sha256Hex, uploadImage } from '@/media/uploads';
import { currentBoardId, useBoardStore } from '@/state/boardStore';
import type { ImageRef } from '@/model/element';

/**
 * On an account board the image is named by its hash and stored in R2 — it goes on
 * the board at once, with a blurred placeholder, and the upload carries on behind
 * it. The signed-out local board has no server, so the bytes stay in the document.
 */
async function storeImage(blob: Blob): Promise<ImageRef> {
  const prepared = await prepareImage(blob);
  const { naturalWidth, naturalHeight, placeholder } = prepared;
  const boardId = currentBoardId();

  if (!boardId) {
    return { src: await blobToDataUrl(prepared.blob), naturalWidth, naturalHeight };
  }

  const fileId = await sha256Hex(prepared.blob);
  void uploadImage(fileId, boardId, prepared.blob);
  return { src: fileUrl(fileId), fileId, naturalWidth, naturalHeight, placeholder };
}

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
      const store = useBoardStore.getState();
      let cursor = screenToBoard(store.viewport, screenPoint);

      for (const blob of blobs) {
        try {
          const imported = await storeImage(blob);
          const box = initialImageBox(imported);
          const current = useBoardStore.getState();

          const element = createElement({
            type: 'image',
            box: { x: cursor.x - box.w / 2, y: cursor.y - box.h / 2, w: box.w, h: box.h },
            z: keyBetween(current.elements.at(-1)?.z ?? null, null),
          });
          element.image = imported;
          current.addElement(element);

          // Several images at once cascade rather than stack invisibly.
          cursor = { x: cursor.x + 28, y: cursor.y + 28 };
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
