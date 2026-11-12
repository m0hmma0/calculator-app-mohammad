import { OUT_DIR, recordingsRoot, type RecordingMeta } from './storage';

/**
 * Recordings kept on this computer's disk (`storage.ts`) that never got their files
 * saved: the tab or the computer stopped mid-recording, or the files were made but
 * neither downloaded nor saved to a folder. They are offered again the next time
 * Sabboura opens. A recording still being made, or whose files are on screen in another
 * tab, is held by a lock and left alone.
 */
const lockName = (id: string) => `sabboura-recording-${id}`;

const releases = new Map<string, () => void>();

/** Holds a recording while this tab is making it or showing its files. */
export function holdRecording(id: string): void {
  if (releases.has(id) || typeof navigator === 'undefined' || !navigator.locks) return;
  void navigator.locks.request(
    lockName(id),
    () => new Promise<void>((resolve) => releases.set(id, resolve)),
  );
}

export function releaseRecording(id: string): void {
  releases.get(id)?.();
  releases.delete(id);
}

export interface Unsaved {
  id: string;
  startedAt: number;
  /** Seconds, when known. */
  length: number | null;
  title: string;
}

/** Recordings left on disk by an earlier visit. */
export async function unsavedRecordings(): Promise<Unsaved[]> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return [];
  const held = new Set(
    ((await navigator.locks?.query())?.held ?? []).map((lock) => lock.name ?? ''),
  );
  const found: Unsaved[] = [];
  const root = await recordingsRoot();
  for await (const [name, handle] of (
    root as FileSystemDirectoryHandle & {
      entries: () => AsyncIterable<[string, FileSystemHandle]>;
    }
  ).entries()) {
    if (handle.kind !== 'directory' || held.has(lockName(name))) continue;
    try {
      const file = await (handle as FileSystemDirectoryHandle).getFileHandle('meta.json');
      const meta = JSON.parse(await (await file.getFile()).text()) as RecordingMeta;
      found.push({
        id: meta.id,
        startedAt: meta.startedAt,
        length: meta.finished?.length ?? null,
        title: meta.title,
      });
    } catch {
      // Not even its description reached the disk: nothing to recover.
      await root.removeEntry(name, { recursive: true }).catch(() => null);
    }
  }
  return found.sort((a, b) => b.startedAt - a.startedAt);
}

/** A finished file of a recording, from disk (a Blob that reads from disk, not memory). */
export async function recordingFile(id: string, file: string): Promise<File> {
  const folder = await (await recordingsRoot()).getDirectoryHandle(id);
  const out = await folder.getDirectoryHandle(OUT_DIR);
  return (await out.getFileHandle(file)).getFile();
}

/** Throws a recording away, from disk. */
export async function discardRecordingFiles(id: string): Promise<void> {
  releaseRecording(id);
  await (await recordingsRoot()).removeEntry(id, { recursive: true }).catch(() => null);
}

/** How much room there is for recordings, in bytes, and whether it is kept for good. */
export async function recordingSpace(): Promise<{ free: number; kept: boolean } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const kept = (await navigator.storage.persisted?.()) ?? false;
  return { free: Math.max(0, quota - usage), kept };
}

/** Asks the browser not to clear the recordings when the disk runs low. */
export async function keepRecordings(): Promise<boolean> {
  try {
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}
