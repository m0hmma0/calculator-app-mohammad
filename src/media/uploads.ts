import { create } from 'zustand';
import { fileUrl } from '@shared/files';
import { currentIdToken } from '@/auth/session';
import { primeImage } from './images';
import { loadPending, removePending, savePending } from './pendingUploads';

export interface UploadState {
  loaded: number;
  total: number;
  /** `waiting` is a failure that will be retried; `rejected` will not be. */
  status: 'uploading' | 'waiting' | 'rejected';
}

interface UploadsStore {
  byId: Record<string, UploadState>;
}

/**
 * Uploads in flight, by file id. The canvas reads it to draw progress over an image,
 * the status bar to say how much is left; neither needs to know how uploads work.
 */
export const useUploads = create<UploadsStore>(() => ({ byId: {} }));

function setState(fileId: string, state: UploadState | null): void {
  useUploads.setState((current) => {
    const byId = { ...current.byId };
    if (state) byId[fileId] = state;
    else delete byId[fileId];
    return { byId };
  });
}

export function uploadStateOf(fileId: string | undefined): UploadState | undefined {
  return fileId ? useUploads.getState().byId[fileId] : undefined;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class UploadError extends Error {
  constructor(
    message: string,
    /** Some refusals (too large, not an image) will not change on a retry. */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Already stored? Then this board simply starts using it and nothing is sent. */
async function attach(fileId: string, boardId: string): Promise<boolean> {
  const token = await currentIdToken();
  const response = await fetch(`${fileUrl(fileId)}/attach?board=${encodeURIComponent(boardId)}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (response.ok) return true;
  if (response.status === 404) {
    const body = (await response.json().catch(() => ({}))) as { stored?: boolean };
    // A 404 without `stored: false` is the board itself being gone.
    if (body.stored === false) return false;
    throw new UploadError('That board no longer exists', true);
  }
  throw new UploadError(`Could not reach the server (${response.status})`, false);
}

/** XMLHttpRequest rather than fetch, because only it reports upload progress. */
async function send(fileId: string, boardId: string, blob: Blob): Promise<void> {
  const token = await currentIdToken();
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', `${fileUrl(fileId)}?board=${encodeURIComponent(boardId)}`);
    if (token) request.setRequestHeader('authorization', `Bearer ${token}`);
    request.setRequestHeader('content-type', blob.type || 'application/octet-stream');

    request.upload.onprogress = (event) => {
      setState(fileId, {
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : blob.size,
        status: 'uploading',
      });
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else {
        const permanent = [400, 404, 413, 415].includes(request.status);
        reject(new UploadError(`Upload refused (${request.status})`, permanent));
      }
    };
    request.onerror = () => reject(new UploadError('Network error', false));
    request.send(blob);
  });
}

const inFlight = new Set<string>();
const RETRY_DELAYS_MS = [3000, 10_000, 30_000, 60_000];

async function upload(fileId: string, boardId: string, blob: Blob, attempt = 0): Promise<void> {
  if (inFlight.has(fileId)) return;
  inFlight.add(fileId);
  setState(fileId, { loaded: 0, total: blob.size, status: 'uploading' });

  try {
    if (!(await attach(fileId, boardId))) await send(fileId, boardId, blob);
    // This tab has the bytes already; showing them needs no download.
    await primeImage(fileUrl(fileId), blob);
    setState(fileId, null);
    await removePending(fileId);
  } catch (error) {
    const permanent = error instanceof UploadError && error.permanent;
    setState(fileId, { loaded: 0, total: blob.size, status: permanent ? 'rejected' : 'waiting' });
    if (permanent) {
      await removePending(fileId);
    } else {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
      setTimeout(() => {
        // Coming back online may already have finished it.
        if (uploadStateOf(fileId)?.status === 'waiting')
          void upload(fileId, boardId, blob, attempt + 1);
      }, delay);
    }
  } finally {
    inFlight.delete(fileId);
  }
}

/**
 * Starts storing an image for a board. Returns at once: the image goes onto the
 * board straight away, with its blurred placeholder, and sharpens when this lands.
 */
export async function uploadImage(fileId: string, boardId: string, blob: Blob): Promise<void> {
  setState(fileId, { loaded: 0, total: blob.size, status: 'uploading' });
  // Kept on disk first, so a tab closed mid-upload can finish the job next time.
  await savePending({ fileId, boardId, blob });
  await upload(fileId, boardId, blob);
}

/**
 * Picks up uploads an earlier visit to this board left unfinished. Called when a
 * board opens, with the images its document refers to.
 */
export async function resumeUploads(boardId: string, fileIds: readonly string[]): Promise<void> {
  await Promise.all(
    fileIds.map(async (fileId) => {
      if (inFlight.has(fileId)) return;
      const pending = await loadPending(fileId);
      if (pending) await upload(fileId, boardId, pending.blob);
    }),
  );
}

// Coming back online is the best moment to retry, not whenever the backoff says.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    for (const [fileId, state] of Object.entries(useUploads.getState().byId)) {
      if (state.status !== 'waiting' || inFlight.has(fileId)) continue;
      void loadPending(fileId).then((pending) => {
        if (pending) void upload(fileId, pending.boardId, pending.blob);
      });
    }
  });
}
