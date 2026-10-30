import * as Y from 'yjs';

/**
 * Images are stored once each, named by the SHA-256 of their bytes. The name is the
 * whole address: anyone holding it can read the image, and nobody can guess it
 * without already having the picture. That is what lets the browser and the edge
 * cache it forever, and what will let a shared board's viewers see its images.
 */
export const FILE_ROUTE = '/api/files/';

/** Larger than any image the browser sends after downsampling, with room to spare. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
] as const;

/** Video and sound files that can be put on a board and played there. */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'] as const;
export const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/webm',
  'audio/flac',
] as const;

/** A video can be a few minutes of a phone's recording; a sound, a song. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export type MediaKind = 'video' | 'audio';

export function mediaKindOf(contentType: string): MediaKind | null {
  if ((VIDEO_TYPES as readonly string[]).includes(contentType)) return 'video';
  if ((AUDIO_TYPES as readonly string[]).includes(contentType)) return 'audio';
  return null;
}

/** The most that may be stored under one name, for this kind of file. */
export function maxBytesFor(contentType: string): number {
  const kind = mediaKindOf(contentType);
  return kind === 'video' ? MAX_VIDEO_BYTES : kind === 'audio' ? MAX_AUDIO_BYTES : MAX_FILE_BYTES;
}

const FILE_ID = /^[0-9a-f]{64}$/;

export const isFileId = (value: unknown): value is string =>
  typeof value === 'string' && FILE_ID.test(value);

export const fileUrl = (fileId: string): string => `${FILE_ROUTE}${fileId}`;

/**
 * What to change to turn the list of files a board is recorded as using into the list
 * it uses now: the files to add and the ones to take off. Nothing, when nothing changed.
 */
export function fileListChanges(
  recorded: Iterable<string>,
  wanted: Iterable<string>,
): { add: string[]; remove: string[] } {
  const before = new Set(recorded);
  const after = new Set(wanted);
  return {
    add: [...after].filter((fileId) => !before.has(fileId)),
    remove: [...before].filter((fileId) => !after.has(fileId)),
  };
}

/**
 * Which stored files — images, videos, sounds — a board uses, read from its own Yjs
 * document. The Worker reads this from the document itself rather than trusting a
 * list from the browser, so the record of what is in use cannot drift from what is
 * actually on the board.
 */
export function fileIdsInDoc(doc: Y.Doc): string[] {
  const found = new Set<string>();
  doc.getMap('elements').forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const image = value.get('image') as { fileId?: unknown } | undefined;
    if (isFileId(image?.fileId)) found.add(image.fileId);
    // A video or a sound uploaded to the board is stored the same way.
    const embed = value.get('embed') as { fileId?: unknown } | undefined;
    if (isFileId(embed?.fileId)) found.add(embed.fileId);
  });
  return [...found];
}

export function fileIdsInUpdate(update: Uint8Array): string[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, update);
    return fileIdsInDoc(doc);
  } finally {
    doc.destroy();
  }
}

/**
 * The words on a board, lowercased, for search. Text is a Y.Text from Phase 7 on and
 * a plain string before it; both are read.
 */
export function searchTextInDoc(doc: Y.Doc, limit = 4000): string {
  const words: string[] = [];
  let length = 0;
  doc.getMap('elements').forEach((value) => {
    if (!(value instanceof Y.Map) || length > limit) return;
    const raw = value.get('text');
    const text = (
      raw instanceof Y.Text ? raw.toString() : typeof raw === 'string' ? raw : ''
    ).trim();
    if (!text) return;
    words.push(text);
    length += text.length + 1;
  });
  return words.join(' ').slice(0, limit).toLowerCase();
}
