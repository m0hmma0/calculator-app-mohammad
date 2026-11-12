import { create } from 'zustand';

/**
 * A folder on this computer where finished recordings are saved by themselves — no
 * Download to press. Chosen once (Chrome and Edge, on a computer), remembered in this
 * browser; the browser asks again for permission now and then, which is done when Record
 * is pressed, since it may only ask in a click.
 */
type FolderHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
};

type Picker = (options: {
  id?: string;
  mode?: 'readwrite';
  startIn?: string;
}) => Promise<FileSystemDirectoryHandle>;

export const folderPickerAvailable = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

interface FolderStore {
  handle: FolderHandle | null;
  /** Whether the browser lets the app write there now. */
  allowed: boolean;
}

export const useRecordingFolder = create<FolderStore>(() => ({ handle: null, allowed: false }));

const DB = 'sabboura-recording';
const STORE = 'kv';
const KEY = 'folder';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function stored(value?: FolderHandle | null): Promise<FolderHandle | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, value === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore(STORE);
    const request =
      value === undefined
        ? store.get(KEY)
        : value === null
          ? store.delete(KEY)
          : store.put(value, KEY);
    request.onsuccess = () =>
      resolve(value === undefined ? ((request.result as FolderHandle | undefined) ?? null) : value);
    request.onerror = () => reject(request.error);
  });
}

async function permission(handle: FolderHandle, ask: boolean): Promise<boolean> {
  try {
    const now = (await handle.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
    if (now === 'granted') return true;
    if (!ask || !handle.requestPermission) return false;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** The folder remembered from before, if any; not asking for permission yet. */
export async function loadRecordingFolder(): Promise<void> {
  try {
    const handle = await stored();
    useRecordingFolder.setState({
      handle,
      allowed: handle ? await permission(handle, false) : false,
    });
  } catch {
    // No storage: no folder.
  }
}

/** Asks which folder. Must run in a click. */
export async function chooseRecordingFolder(): Promise<boolean> {
  const picker = (window as Window & { showDirectoryPicker?: Picker }).showDirectoryPicker;
  if (!picker) return false;
  try {
    const handle = (await picker({
      id: 'sabboura-recordings',
      mode: 'readwrite',
      startIn: 'documents',
    })) as FolderHandle;
    await stored(handle);
    useRecordingFolder.setState({ handle, allowed: await permission(handle, true) });
    return true;
  } catch {
    return false; // Cancelled.
  }
}

export async function forgetRecordingFolder(): Promise<void> {
  await stored(null).catch(() => null);
  useRecordingFolder.setState({ handle: null, allowed: false });
}

/** Makes sure the folder may be written to, asking if need be. Must run in a click. */
export async function allowRecordingFolder(): Promise<boolean> {
  const { handle } = useRecordingFolder.getState();
  if (!handle) return false;
  const allowed = await permission(handle, true);
  useRecordingFolder.setState({ allowed });
  return allowed;
}

/** A name not yet taken in the folder: "Name.mp4", else "Name (2).mp4", and so on. */
async function freeName(folder: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let count = 1; count < 1000; count += 1) {
    const candidate = count === 1 ? name : `${stem} (${count})${extension}`;
    try {
      await folder.getFileHandle(candidate);
    } catch {
      return candidate;
    }
  }
  return `${stem} ${Date.now()}${extension}`;
}

/** Writes the files into the folder. The folder's name, or null if it could not. */
export async function saveToRecordingFolder(
  files: Array<{ name: string; blob: Blob }>,
): Promise<string | null> {
  const { handle, allowed } = useRecordingFolder.getState();
  if (!handle || !allowed) return null;
  for (const file of files) {
    const target = await handle.getFileHandle(await freeName(handle, file.name), { create: true });
    const writable = await target.createWritable();
    await file.blob.stream().pipeTo(writable);
  }
  return handle.name;
}
