import { useEffect, useState } from 'react';
import {
  AUDIO_TYPES,
  fileUrl,
  maxBytesFor,
  mediaKindOf,
  VIDEO_TYPES,
  type MediaKind,
} from '@shared/files';
import type { Point } from '@/geometry';
import type { BoardElement, EmbedData } from '@/model/element';
import { currentBoardId, useBoardStore } from '@/state/boardStore';
import { sha256Hex, uploadFile } from './uploads';

/**
 * Videos and sounds put on a board from a file. On an account board each is stored
 * once under its hash, like a picture, and plays from there; this tab plays its own
 * copy until the upload lands. The signed-out board has no server, so the bytes stay
 * in this browser (IndexedDB) and the board names them `local-media:<hash>`.
 */
const LOCAL_PREFIX = 'local-media:';

const EXTENSIONS: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
};

/** A file's media type, from what it says or, failing that, its name. */
export function mediaTypeOf(file: Pick<File, 'type' | 'name'>): string | null {
  if (mediaKindOf(file.type)) return file.type;
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  return EXTENSIONS[extension] ?? null;
}

export const isMediaFile = (file: File) => mediaTypeOf(file) !== null;

/** What the file picker offers, alongside pictures and PDFs. */
export const MEDIA_ACCEPT = [
  ...VIDEO_TYPES,
  ...AUDIO_TYPES,
  ...Object.keys(EXTENSIONS).map((extension) => `.${extension}`),
].join(',');

/* ------------------- where this tab plays each file from ------------------- */

/** Files this tab holds the bytes of: just added, or read back from this browser. */
const local = new Map<string, string>();

const DB_NAME = 'sabboura-media';
const STORE = 'files';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function keepInBrowser(hash: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(blob, hash);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
  });
}

async function readFromBrowser(hash: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(hash);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => resolve(null);
  });
}

/**
 * The address a `<video>` or `<audio>` plays a media embed from: this tab's own copy
 * when it has one, the stored file, or the address on another site. Null while a
 * file kept in this browser is being read back.
 */
export function useMediaSrc(embed: EmbedData): string | null {
  const key = embed.fileId ?? (embed.url.startsWith(LOCAL_PREFIX) ? embed.url : null);
  const [, setLoaded] = useState(0);
  const hash = embed.url.startsWith(LOCAL_PREFIX) ? embed.url.slice(LOCAL_PREFIX.length) : null;

  useEffect(() => {
    if (!hash || local.has(embed.url)) return;
    let cancelled = false;
    void readFromBrowser(hash).then((blob) => {
      if (!blob || cancelled) return;
      local.set(embed.url, URL.createObjectURL(blob));
      setLoaded((count) => count + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [hash, embed.url]);

  if (key && local.has(key)) return local.get(key)!;
  return hash ? null : embed.url;
}

/* ------------------------------ adding one ------------------------------ */

export class MediaError extends Error {}

/** Stores a video or sound for the board in view, and says what the embed holds. */
export async function storeMedia(file: File): Promise<EmbedData> {
  const type = mediaTypeOf(file);
  const kind: MediaKind | null = type ? mediaKindOf(type) : null;
  if (!type || !kind) throw new MediaError(`${file.name} is not a video or a sound file.`);
  const limit = maxBytesFor(type);
  if (file.size > limit) {
    throw new MediaError(
      `${file.name} is ${Math.ceil(file.size / 1048576)} MB; a ${kind} can be up to ${limit / 1048576} MB.`,
    );
  }

  // Typed as what it is, so the server and the player both know.
  const blob = file.type === type ? file : new Blob([file], { type });
  const hash = await sha256Hex(blob);
  const title = file.name.replace(/\.[^.]+$/, '') || (kind === 'video' ? 'Video' : 'Sound');
  const boardId = currentBoardId();

  if (!boardId) {
    const url = `${LOCAL_PREFIX}${hash}`;
    local.set(url, URL.createObjectURL(blob));
    await keepInBrowser(hash, blob);
    return { kind: 'media', media: kind, url, title };
  }

  local.set(hash, URL.createObjectURL(blob));
  void uploadFile(hash, boardId, blob);
  return { kind: 'media', media: kind, url: fileUrl(hash), fileId: hash, title };
}

/** A video's shape, read from the file itself; 16:9 if it will not say in time. */
function videoShape(src: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const done = (ratio: number) => {
      video.removeAttribute('src');
      video.load();
      resolve(ratio);
    };
    const timer = setTimeout(() => done(16 / 9), 3000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done(
        video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : 16 / 9,
      );
    };
    video.onerror = () => {
      clearTimeout(timer);
      done(16 / 9);
    };
    video.src = src;
  });
}

/** How big a video or a sound starts on the board. */
export const MEDIA_WIDTH = 480;
export const AUDIO_SIZE = { w: 360, h: 112 };

/** The size an embed of this kind starts at; a video as wide as MEDIA_WIDTH, in its shape. */
export function embedSize(embed: EmbedData, ratio = 16 / 9): { w: number; h: number } {
  if (embed.media === 'audio') {
    return embed.kind === 'player' ? { w: 360, h: 152 } : AUDIO_SIZE;
  }
  const clamped = Math.min(3, Math.max(0.5, ratio));
  return { w: MEDIA_WIDTH, h: Math.round(MEDIA_WIDTH / clamped) };
}

/** Puts a video or a sound file on the board, centred on `at` or in view. */
export async function insertMedia(file: File, at?: Point): Promise<BoardElement | null> {
  const embed = await storeMedia(file);
  const store = useBoardStore.getState();
  const src = embed.fileId ? local.get(embed.fileId) : local.get(embed.url);
  const ratio = embed.media === 'video' && src ? await videoShape(src) : 16 / 9;
  const size = embedSize(embed, ratio);
  const element = store.insertAt('embed', size, { embed });
  if (!element) return null;
  if (!at) return element;
  const moved = { x: at.x - size.w / 2, y: at.y - size.h / 2 };
  store.applyDiscrete(new Map([[element.id, moved]]));
  return { ...element, ...moved };
}
