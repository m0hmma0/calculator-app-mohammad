import type { OpenBoardResponse } from '@shared/sharing';
import { api, ApiError } from '@/api/client';
import { fileUrl } from '@shared/files';
import { RoomConnection, type RoomEvents } from '@/collab/connection';
import { renderToCanvas } from '@/export/exporters';
import { dataUrlToBlob, prepareImage } from '@/media/images';
import { resumeUploads, sha256Hex, uploadImage } from '@/media/uploads';
import type { BoardElement, ImageRef } from '@/model/element';
import { REMOTE_ORIGIN, SYSTEM_ORIGIN, type BoardDoc } from './board';
import { patchYElement } from './schema';

const THUMBNAIL_DELAY_MS = 2500;
const THUMBNAIL_WIDTH = 480;

/**
 * Since Phase 7 a board lives in its room: every change streams there as it happens,
 * and the room keeps the log, writes the snapshot, and records what the board uses.
 * What is left for the browser is what only a browser can do — draw the thumbnail —
 * and moving images into storage.
 */
export interface BoardSync {
  room: RoomConnection;
  /** What the server said about this board and this person; null when offline. */
  opened: OpenBoardResponse | null;
  /** Sends anything outstanding — called before leaving a board. */
  flush: () => Promise<void>;
  stop: () => void;
}

async function thumbnailOf(elements: readonly BoardElement[]): Promise<Blob | null> {
  if (elements.length === 0) return null;
  try {
    const host = document.querySelector('[data-testid="stage"]') ?? document.documentElement;
    const canvas = renderToCanvas(elements, { host, scale: 1, padding: 40, background: null });
    // Scale the full-size render down rather than rendering twice.
    const target = document.createElement('canvas');
    const ratio = Math.min(1, THUMBNAIL_WIDTH / Math.max(1, canvas.width));
    target.width = Math.max(1, Math.round(canvas.width * ratio));
    target.height = Math.max(1, Math.round(canvas.height * ratio));

    const ctx = target.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, target.width, target.height);
    return await new Promise<Blob | null>((resolve) => target.toBlob(resolve, 'image/png'));
  } catch {
    // A thumbnail is a nicety; never let it get in the way.
    return null;
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

  // Repointing an element is an edit; someone who can only view leaves it be.
  if (doc.readOnly) return;
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

export interface BoardSyncOptions {
  elementsNow: () => readonly BoardElement[];
  events: Omit<RoomEvents, 'synced'> & { synced?: () => void };
  /** A new thumbnail is stored. */
  onSaved?: () => void;
  onOpened?: (opened: OpenBoardResponse | null) => void;
}

/**
 * Opens a board: checks it is this person's (a 404 has to surface, not open as a
 * blank canvas), then joins its room. Offline, the check fails softly and the local
 * copy opens; the room is joined as soon as the network returns.
 */
export async function startBoardSync(
  doc: BoardDoc,
  boardId: string,
  options: BoardSyncOptions,
): Promise<BoardSync> {
  const opened = await api.openBoard(boardId).catch((error: unknown) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 401)) throw error;
    return null;
  });
  // Known before the room connects, so a viewer never gets a moment of editing.
  options.onOpened?.(opened);

  let stopped = false;
  let thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
  let thumbnailDue = false;

  const writeThumbnail = async () => {
    thumbnailTimer = null;
    if (!thumbnailDue) return;
    thumbnailDue = false;
    const blob = await thumbnailOf(options.elementsNow());
    if (!blob) return;
    await api
      .saveThumbnail(boardId, blob)
      .then(() => options.onSaved?.())
      .catch(() => {
        thumbnailDue = true;
      });
  };

  // Whoever changes the board draws its thumbnail; someone only watching does not.
  const onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || stopped) return;
    thumbnailDue = true;
    if (thumbnailTimer !== null) clearTimeout(thumbnailTimer);
    thumbnailTimer = setTimeout(() => void writeThumbnail(), THUMBNAIL_DELAY_MS);
  };
  doc.doc.on('update', onUpdate);

  // Housekeeping on the board's images waits until this browser has the whole board:
  // its local copy (which may hold uploads an earlier visit did not finish) and the
  // room's (which, on a device that never opened it, is all of it). Neither should
  // hold up opening the board.
  let tidied = false;
  const tidyImages = async () => {
    if (tidied || stopped) return;
    tidied = true;
    await doc.whenReady;
    await resumeUploads(boardId, fileIdsOn(doc));
    if (!stopped) await moveInlineImages(doc, boardId);
  };

  const room = new RoomConnection(doc, boardId, {
    ...options.events,
    synced: () => {
      options.events.synced?.();
      void tidyImages();
    },
  });
  room.start();

  return {
    room,
    opened,
    flush: async () => {
      if (thumbnailTimer !== null) {
        clearTimeout(thumbnailTimer);
        await writeThumbnail();
      }
      await room.flush();
    },
    stop: () => {
      stopped = true;
      if (thumbnailTimer !== null) clearTimeout(thumbnailTimer);
      doc.doc.off('update', onUpdate);
      room.stop();
    },
  };
}
