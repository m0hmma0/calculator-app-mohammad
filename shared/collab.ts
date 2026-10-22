import type { Role } from './sharing';

/**
 * The wire protocol between a browser and a board's room (a Durable Object).
 *
 * Document traffic is binary: one kind byte, then the payload.
 *
 *   SYNC_STEP1   "here is my state vector" — the other side answers with SYNC_STEP2
 *   SYNC_STEP2   everything the asker was missing, as one Yjs update
 *   UPDATE       a change made since
 *   HISTORY      a past state of the board, for the history scrubber
 *   CHUNK        one piece of a frame too large to send whole
 *
 * Everything else — sign-in, presence, history listings — is JSON text.
 *
 * Both sides sync each other on connect, which is what makes offline work merge: the
 * room learns what the browser did while disconnected in the same exchange that
 * brings the browser up to date.
 */

export const FRAME = {
  SYNC_STEP1: 0,
  SYNC_STEP2: 1,
  UPDATE: 2,
  HISTORY: 3,
  CHUNK: 9,
} as const;

/** WebSocket messages over 1 MiB are refused; stay well under it. */
export const MAX_FRAME_BYTES = 512 * 1024;

export function frame(kind: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(payload.length + 1);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

/**
 * Splits a frame into CHUNK frames if it is too large to send whole:
 * [CHUNK][id u32][index u16][total u16][bytes].
 */
export function splitFrame(data: Uint8Array<ArrayBuffer>, id: number): Uint8Array<ArrayBuffer>[] {
  if (data.length <= MAX_FRAME_BYTES) return [data];
  const total = Math.ceil(data.length / MAX_FRAME_BYTES);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = data.subarray(index * MAX_FRAME_BYTES, (index + 1) * MAX_FRAME_BYTES);
    const out = new Uint8Array(slice.length + 9);
    const view = new DataView(out.buffer);
    out[0] = FRAME.CHUNK;
    view.setUint32(1, id);
    view.setUint16(5, index);
    view.setUint16(7, total);
    out.set(slice, 9);
    parts.push(out);
  }
  return parts;
}

/**
 * Reassembles CHUNK frames. Returns the whole frame once its last piece arrives, the
 * frame itself if it was never split, and null while pieces are still missing.
 */
export class FrameAssembler {
  private readonly pending = new Map<number, { parts: Uint8Array[]; received: number }>();

  accept(data: Uint8Array): Uint8Array | null {
    if (data[0] !== FRAME.CHUNK) return data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint16(5);
    const total = view.getUint16(7);

    let entry = this.pending.get(id);
    if (!entry) {
      entry = { parts: new Array<Uint8Array>(total), received: 0 };
      this.pending.set(id, entry);
    }
    if (!entry.parts[index]) {
      entry.parts[index] = data.slice(9);
      entry.received += 1;
    }
    if (entry.received < total) return null;

    this.pending.delete(id);
    const length = entry.parts.reduce((sum, part) => sum + part.length, 0);
    const whole = new Uint8Array(length);
    let offset = 0;
    for (const part of entry.parts) {
      whole.set(part, offset);
      offset += part.length;
    }
    return whole;
  }
}

/** Who someone is, as the room vouches for it — taken from their verified token. */
export interface PeerIdentity {
  uid: string;
  name: string;
  picture: string | null;
  color: string;
}

/** What a browser shares about itself. None of it is saved. */
export interface PresenceState {
  /** Pointer position in board coordinates, or null when off the canvas. */
  cursor: { x: number; y: number } | null;
  selection: string[];
  /** What this person can see: the top-left corner, zoom, and the size of the stage. */
  view: { x: number; y: number; zoom: number; width: number; height: number };
  /** Laser points with their age in milliseconds when sent. */
  laser: { points: Array<{ x: number; y: number; age: number }>; lifetimeMs: number } | null;
  /** Cursor chat: what they are typing right now, if anything. */
  chat: string | null;
  /** Asking everyone to follow along. */
  spotlight: boolean;
  /** Which page of the board they are on. Absent from browsers older than pages. */
  page?: string;
  /** Presenting: the frame on screen, which followers fit to their own screens. */
  present?: { frame: string } | null;
}

export interface HistoryCheckpoint {
  seq: number;
  at: number;
  name: string | null;
}

export type ClientMessage =
  /**
   * The handshake. `token` is a Firebase ID token, or empty for a guest; `link` is
   * the share link they came in by, if any; `guest` is the name a guest gave.
   */
  | { t: 'auth'; token: string; link?: string | null; guest?: { id: string; name: string } | null }
  | { t: 'presence'; state: PresenceState }
  | { t: 'history' }
  | { t: 'history-state'; seq: number; req: number }
  | { t: 'checkpoint'; name: string };

export type ServerMessage =
  | {
      t: 'ready';
      session: string;
      you: PeerIdentity;
      /** What this person may do here. A viewer's edits are refused by the room. */
      role: Role;
      /** The room's clock, so a shared timer ends at the same moment on every screen. */
      now: number;
      peers: Array<{ session: string; user: PeerIdentity }>;
    }
  /** Sharing changed while connected: this is what they may do now. */
  | { t: 'role'; role: Role; canExport: boolean }
  /** Comments on the board changed; fetch them again. */
  | { t: 'comments' }
  | { t: 'join'; session: string; user: PeerIdentity }
  | { t: 'leave'; session: string }
  | { t: 'presence'; session: string; user: PeerIdentity; state: PresenceState }
  /** One per UPDATE or SYNC_STEP2 received, once it is stored. */
  | { t: 'ack' }
  | {
      t: 'history';
      first: number;
      last: number;
      firstAt: number;
      lastAt: number;
      checkpoints: HistoryCheckpoint[];
    }
  /** Precedes the binary HISTORY frame it describes. */
  | { t: 'history-state'; req: number; seq: number; at: number }
  | {
      t: 'error';
      message: string;
      /** `read-only`: an edit from someone who may not edit, dropped. The socket stays. */
      code: 'unauthorised' | 'not-found' | 'bad-request' | 'read-only' | 'revoked';
    };

/**
 * A colour per person, the same in every window and on every device, so "the purple
 * cursor" means the same person to everyone. Chosen to read on both themes.
 */
const PEER_COLORS = [
  '#e5484d',
  '#f76b15',
  '#ad7f00',
  '#30a46c',
  '#0d9b8a',
  '#0090ff',
  '#3e63dd',
  '#8e4ec6',
  '#d6409f',
  '#7c6f64',
];

export function colorFor(uid: string): string {
  let hash = 2166136261;
  for (let index = 0; index < uid.length; index += 1) {
    hash ^= uid.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return PEER_COLORS[(hash >>> 0) % PEER_COLORS.length]!;
}
