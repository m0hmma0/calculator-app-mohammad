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

const FILE_ID = /^[0-9a-f]{64}$/;

export const isFileId = (value: unknown): value is string =>
  typeof value === 'string' && FILE_ID.test(value);

export const fileUrl = (fileId: string): string => `${FILE_ROUTE}${fileId}`;

/**
 * Which stored images a board uses, read from its own Yjs document. The Worker reads
 * this from the document itself rather than trusting a list from the browser, so the
 * record of what is in use cannot drift from what is actually on the board.
 */
export function fileIdsInDoc(doc: Y.Doc): string[] {
  const found = new Set<string>();
  doc.getMap('elements').forEach((value) => {
    if (!(value instanceof Y.Map)) return;
    const image = value.get('image') as { fileId?: unknown } | undefined;
    if (isFileId(image?.fileId)) found.add(image.fileId);
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
