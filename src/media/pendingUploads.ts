/**
 * Images waiting to reach the server, kept in IndexedDB so closing the tab — or the
 * browser — before an upload finishes does not lose the picture. The board document
 * already names the image; this holds the bytes until the server does.
 *
 * Every call degrades to a no-op where IndexedDB is unavailable (a private window in
 * some browsers): uploads still happen, they just do not survive a reload mid-way.
 */
export interface PendingUpload {
  fileId: string;
  boardId: string;
  blob: Blob;
}

const DB_NAME = 'sabboura-uploads';
const STORE = 'pending';

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'fileId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await open();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function savePending(upload: PendingUpload): Promise<void> {
  await run('readwrite', (store) => store.put(upload));
}

export async function loadPending(fileId: string): Promise<PendingUpload | undefined> {
  return run<PendingUpload>('readonly', (store) => store.get(fileId) as IDBRequest<PendingUpload>);
}

export async function removePending(fileId: string): Promise<void> {
  await run('readwrite', (store) => store.delete(fileId));
}
