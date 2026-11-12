/**
 * A recording on this computer's disk while it is being made, so nothing is lost if the
 * browser, the tab or the computer stops: the browser's private file storage (OPFS),
 * one folder per recording —
 *
 *   recordings/<id>/meta.json        what it is: size, codecs, sounds, when; whether finished
 *   recordings/<id>/video.bin        every encoded picture, as made
 *   recordings/<id>/video.json       how to decode them (written with the first)
 *   recordings/<id>/sound-<n>.bin    the same for each sound (mix, mic, slides)
 *   recordings/<id>/out/…            the finished files, made from the above
 *
 * A .bin is a run of records: a 21-byte head (key frame or not, timestamp and duration in
 * microseconds, the data's length) and the data. The worker writes them as they come
 * and has them put to disk every second; a record cut short by a crash is simply where
 * reading stops. Shared by the encoding worker and the page (recovery, downloads).
 */
export const RECORDINGS_DIR = 'recordings';
export const OUT_DIR = 'out';
const HEAD = 21;

export interface RecordingMeta {
  id: string;
  /** Date.now() when it began. */
  startedAt: number;
  width: number;
  height: number;
  fps: number;
  aac: boolean;
  /** The sounds recorded, by name (mix, mic, slides). */
  sounds: string[];
  /** The board's name, for the files' names. */
  title: string;
  /** Set when Stop was pressed and everything was written: its length in seconds. */
  finished?: { length: number };
  /** Set when the finished files have been made. */
  made?: Array<{ kind: string; file: string; extension: string }>;
}

export interface StoredPacket {
  key: boolean;
  /** Microseconds. */
  timestamp: number;
  duration: number;
  data: Uint8Array;
}

export async function recordingsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(RECORDINGS_DIR, { create: true });
}

export function encodeHead(packet: Omit<StoredPacket, 'data'>, length: number): Uint8Array {
  const head = new Uint8Array(HEAD);
  const view = new DataView(head.buffer);
  view.setUint8(0, packet.key ? 1 : 0);
  view.setFloat64(1, packet.timestamp, true);
  view.setFloat64(9, packet.duration, true);
  view.setUint32(17, length, true);
  return head;
}

/** Reads a .bin's records in order, a few megabytes at a time. */
export class PacketReader {
  private buffer = new Uint8Array(0);
  private start = 0;
  private offset = 0;
  private ended = false;

  constructor(private readonly file: Blob) {}

  private async fill(needed: number): Promise<boolean> {
    while (this.buffer.length - this.start < needed) {
      if (this.offset >= this.file.size) return false;
      const take = Math.max(needed, 4 * 1024 * 1024);
      const next = new Uint8Array(
        await this.file.slice(this.offset, this.offset + take).arrayBuffer(),
      );
      this.offset += next.length;
      const rest = this.buffer.subarray(this.start);
      const merged = new Uint8Array(rest.length + next.length);
      merged.set(rest);
      merged.set(next, rest.length);
      this.buffer = merged;
      this.start = 0;
    }
    return true;
  }

  async next(): Promise<StoredPacket | null> {
    if (this.ended || !(await this.fill(HEAD))) return null;
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.start, HEAD);
    const key = view.getUint8(0) === 1;
    const timestamp = view.getFloat64(1, true);
    const duration = view.getFloat64(9, true);
    const length = view.getUint32(17, true);
    // A record cut short — the end of what reached the disk.
    if (!(await this.fill(HEAD + length)) || !Number.isFinite(timestamp)) {
      this.ended = true;
      return null;
    }
    const data = this.buffer.slice(this.start + HEAD, this.start + HEAD + length);
    this.start += HEAD + length;
    return { key, timestamp, duration, data };
  }
}

/** A decoder config as JSON: its `description` bytes (H.264's avcC) as base64. */
export function configToJson(config: VideoDecoderConfig | AudioDecoderConfig): string {
  const { description, ...rest } = config as { description?: AllowSharedBufferSource };
  let bytes: string | undefined;
  if (description) {
    const view =
      description instanceof ArrayBuffer
        ? new Uint8Array(description)
        : new Uint8Array(
            (description as ArrayBufferView).buffer,
            (description as ArrayBufferView).byteOffset,
            (description as ArrayBufferView).byteLength,
          );
    let binary = '';
    for (const byte of view) binary += String.fromCharCode(byte);
    bytes = btoa(binary);
  }
  return JSON.stringify({ ...rest, description: bytes });
}

export function configFromJson<T extends VideoDecoderConfig | AudioDecoderConfig>(text: string): T {
  const parsed = JSON.parse(text) as T & { description?: string };
  if (typeof parsed.description === 'string') {
    const binary = atob(parsed.description);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { ...parsed, description: bytes } as T;
  }
  const { description: _drop, ...rest } = parsed;
  void _drop;
  return rest as T;
}
