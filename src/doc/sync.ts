import * as Y from 'yjs';
import { api, ApiError } from '@/api/client';
import { fileUrl } from '@shared/files';
import { renderToCanvas } from '@/export/exporters';
import { dataUrlToBlob, prepareImage } from '@/media/images';
import { resumeUploads, sha256Hex, uploadImage } from '@/media/uploads';
import type { BoardElement, ImageRef } from '@/model/element';
import { REMOTE_ORIGIN, SYSTEM_ORIGIN, type BoardDoc } from './board';
import { patchYElement } from './schema';

const SAVE_DELAY_MS = 1200;
const THUMBNAIL_WIDTH = 480;

/**
 * Phase 5 keeps a board on the server as a whole Yjs update, saved a moment after
 * the last change. Phase 7 replaces this with a live room that streams individual
 * updates; what stays is the document itself, which is why the swap is contained.
 */
export interface BoardSync {
  /** Flushes any pending save — called before leaving a board. */
  flush: () => Promise<void>;
  stop: () => void;
}

/** Text a board can be searched by: its own words, not its shapes. */
export function searchTextOf(elements: readonly BoardElement[], limit = 4000): string {
  const words: string[] = [];
  for (const element of elements) {
    const text = element.text?.trim();
    if (text) words.push(text);
    if (words.join(' ').length > limit) break;
  }
  return words.join(' ').slice(0, limit);
}

function thumbnailOf(elements: readonly BoardElement[]): string | undefined {
  if (elements.length === 0) return undefined;
  try {
    const host = document.querySelector('[data-testid="stage"]') ?? document.documentElement;
    const canvas = renderToCanvas(elements, { host, scale: 1, padding: 40, background: null });
    // Scale the full-size render down rather than rendering twice.
    const target = document.createElement('canvas');
    const ratio = Math.min(1, THUMBNAIL_WIDTH / Math.max(1, canvas.width));
    target.width = Math.max(1, Math.round(canvas.width * ratio));
    target.height = Math.max(1, Math.round(canvas.height * ratio));

    const ctx = target.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
    return target.toDataURL('image/png');
  } catch {
    // A thumbnail is a nicety; never let it stop a save.
    return undefined;
  }
}

/**
 * Boards from before Phase 6 carry their images inline as data URLs, which makes
 * every save resend every picture. Each is moved into storage once, the first time
 * the board is opened, and the element is repointed at the stored copy.
 */
async function moveInlineImages(doc: BoardDoc, boardId: string): Promise<void> {
  const inline: Array<[string, string]> = [];
  doc.elements.forEach((map, id) => {
    const image = map.get('image') as ImageRef | undefined;
    if (image?.src.startsWith('data:') && !image.fileId) inline.push([id, image.src]);
  });

  for (const [id, src] of inline) {
    try {
      const prepared = await prepareImage(await dataUrlToBlob(src));
      const fileId = await sha256Hex(prepared.blob);
      void uploadImage(fileId, boardId, prepared.blob);

      doc.doc.transact(() => {
        const map = doc.elements.get(id);
        const current = map?.get('image') as ImageRef | undefined;
        // Someone may have replaced or removed it while this was being prepared.
        if (!map || current?.src !== src) return;
        const image: ImageRef = {
          src: fileUrl(fileId),
          fileId,
          naturalWidth: prepared.naturalWidth,
          naturalHeight: prepared.naturalHeight,
          placeholder: prepared.placeholder,
        };
        patchYElement(map, { image });
      }, SYSTEM_ORIGIN);
    } catch {
      // Left inline: still shows, still saves, and the next visit tries again.
    }
  }
}

/** Images on this board that an earlier visit may not have finished uploading. */
function fileIdsOn(doc: BoardDoc): string[] {
  const ids: string[] = [];
  doc.elements.forEach((map) => {
    const fileId = (map.get('image') as ImageRef | undefined)?.fileId;
    if (fileId) ids.push(fileId);
  });
  return ids;
}

/**
 * Pulls the stored board in, then keeps the server up to date. The incoming update
 * is applied with a remote origin so it is not undoable — opening a board must not
 * leave "undo" poised to erase everything that was already there.
 */
export async function startBoardSync(
  doc: BoardDoc,
  boardId: string,
  elementsNow: () => readonly BoardElement[],
  onSaved?: () => void,
): Promise<BoardSync> {
  // A 404 means this board is not yours — that has to surface, not open as a blank
  // canvas. Anything else (offline, a flaky network) falls back to the local copy.
  const stored = await api.loadSnapshot(boardId).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) throw error;
    return null;
  });
  if (stored && stored.byteLength > 0) {
    Y.applyUpdate(doc.doc, stored, REMOTE_ORIGIN);
    // Nothing from before the board was opened should be undoable.
    doc.undoManager.clear();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let dirty = false;
  let stopped = false;

  const write = async () => {
    if (!dirty || stopped) return;
    dirty = false;
    const bytes = Y.encodeStateAsUpdate(doc.doc);
    const elements = elementsNow();
    await api
      .saveSnapshot(boardId, bytes, {
        searchText: searchTextOf(elements),
        thumbnail: thumbnailOf(elements),
      })
      .then(() => onSaved?.())
      .catch(() => {
        // Offline or refused: the local copy is still safe, and the next change
        // will try again rather than losing what is here.
        dirty = true;
      });
  };

  const schedule = () => {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saving = saving.then(write);
    }, SAVE_DELAY_MS);
  };

  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    // Applying what the server just sent is not a reason to send it straight back.
    if (origin === REMOTE_ORIGIN) return;
    schedule();
  };

  doc.doc.on('update', onUpdate);

  // The local copy (IndexedDB) may hold edits the server has not seen, so both of
  // these wait for it; neither should hold up opening the board.
  void doc.whenReady.then(async () => {
    if (stopped) return;
    await resumeUploads(boardId, fileIdsOn(doc));
    if (!stopped) await moveInlineImages(doc, boardId);
  });

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    saving = saving.then(write);
    await saving;
  };

  return {
    flush,
    stop: () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      doc.doc.off('update', onUpdate);
    },
  };
}
