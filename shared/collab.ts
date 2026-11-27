import { Inflate, deflateSync } from 'fflate';
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
 *   ZIP          a large frame, deflated (Phase 18): a board's first sync is mostly
 *                repeated keys and shrinks about five times
 *   SYNC_STEP2_V2 SYNC_STEP2 in Yjs's second encoding, to pages that ask with `zip`
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
  ZIP: 10,
  /** SYNC_STEP2 in Yjs's second encoding: a board's first sync, a quarter the size. */
  SYNC_STEP2_V2: 11,
} as const;

/** Frames at least this big are deflated, where the other side says it can inflate. */
export const ZIP_FROM = 32 * 1024;
/** What an inflated frame may grow to: a board this big is refused rather than built. */
export const MAX_UNZIPPED_BYTES = 128 * 1024 * 1024;

/** A frame deflated as [ZIP][deflate-raw bytes], if that is worth it; else the frame. */
export function zipFrame(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (data.length < ZIP_FROM) return data;
  const packed = deflateSync(data, { level: 4 });
  if (packed.length >= data.length * 0.9) return data;
  const out = new Uint8Array(packed.length + 1);
  out[0] = FRAME.ZIP;
  out.set(packed, 1);
  return out;
}

/** The frame inside a ZIP frame (any other frame is returned as it is). Throws past `max`. */
export function unzipFrame(data: Uint8Array, max = MAX_UNZIPPED_BYTES): Uint8Array {
  if (data[0] !== FRAME.ZIP) return data;
  const parts: Uint8Array[] = [];
  let length = 0;
  const inflate = new Inflate((chunk) => {
    length += chunk.length;
    if (length > max) throw new Error('Frame too large');
    parts.push(chunk);
  });
  inflate.push(data.subarray(1), true);
  const whole = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    whole.set(part, offset);
    offset += part.length;
  }
  return whole;
}

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

  /**
   * `maxParts`: the most pieces one frame may have. The room sets it, so a frame that
   * claims thousands of pieces cannot make it hold gigabytes; past it, or with more
   * than a few frames half-received, `accept` throws.
   */
  constructor(private readonly maxParts = Infinity) {}

  accept(data: Uint8Array): Uint8Array | null {
    if (data[0] !== FRAME.CHUNK) return data;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const id = view.getUint32(1);
    const index = view.getUint16(5);
    const total = view.getUint16(7);
    if (index >= total) throw new Error('Unreadable frame');

    let entry = this.pending.get(id);
    if (entry && entry.parts.length !== total) throw new Error('Unreadable frame');
    if (!entry) {
      if (total > this.maxParts) throw new Error('Frame too large');
      if (this.maxParts !== Infinity && this.pending.size >= 4) throw new Error('Too many frames');
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
  laser: {
    /** `m`: which mark (one press of the laser) the point belongs to. */
    points: Array<{ x: number; y: number; age: number; m?: number }>;
    lifetimeMs: number;
  } | null;
  /** Cursor chat: what they are typing right now, if anything. */
  chat: string | null;
  /** Asking everyone to follow along. */
  spotlight: boolean;
  /** Sessions asked to follow along one by one (27 November). */
  summoned?: string[];
  /** Which page of the board they are on. Absent from browsers older than pages. */
  page?: string;
  /** Presenting: the frame on screen, which followers fit to their own screens. */
  present?: { frame: string } | null;
  /** The session whose view this browser is following — chosen, or a presenter's. */
  following?: string | null;
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
  | {
      t: 'auth';
      token: string;
      link?: string | null;
      guest?: { id: string; name: string } | null;
      /** This open page, the same on every reconnection, so the room can replace it. */
      tab?: string;
      /**
       * A remote control: the key from its link, in place of a token. It works only
       * while the presenter who made it is presenting, and it lets its holder see the
       * board and move the slides, nothing more.
       */
      remote?: string;
      /** This page inflates ZIP frames (Phase 18); older pages leave it out. */
      zip?: boolean;
    }
  | { t: 'presence'; state: PresenceState }
  | { t: 'history' }
  | { t: 'history-state'; seq: number; req: number }
  | { t: 'checkpoint'; name: string }
  /**
   * The owner, presenting, makes a remote control link (`key`) for this page, and a
   * slides-only link (`watch`) that shows the slides and cannot move them.
   */
  | { t: 'remote-open'; key: string; watch?: string }
  /** The presentation is over: the link stops working and any remote is let go. */
  | { t: 'remote-close' }
  /** The presenter tells the remotes where the talk is. */
  | { t: 'remote-state'; state: RemoteState }
  /** A remote's button: passed to the presenter's page. */
  | { t: 'remote'; action: RemoteAction }
  /** The presenter's video or sound file, played, paused or moved: for slides links. */
  | { t: 'remote-media'; media: RemoteMedia };

/** A video or sound file on a slide, as the presenter's copy is now. */
export interface RemoteMedia {
  id: string;
  playing: boolean;
  time: number;
  rate: number;
}

/** What a remote control can ask the presenter's page to do. */
export type RemoteAction = 'next' | 'previous' | 'first' | 'last';

export const REMOTE_ACTIONS: readonly RemoteAction[] = ['next', 'previous', 'first', 'last'];

/** Where the talk is, for a remote control: the slide, and when presenting began. */
export interface RemoteState {
  frame: string | null;
  /** Epoch milliseconds, for the remote's clock; null before it began. */
  since: number | null;
}

/** A remote control's key: what its link carries. */
export const REMOTE_KEY = /^[\w-]{20,64}$/;

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
      /** The room inflates ZIP frames, so large ones may be sent deflated. */
      zip?: boolean;
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
  /** To the presenter: a remote's button, or `hello` when a remote has connected. */
  | { t: 'remote'; action: RemoteAction | 'hello' }
  /** To a remote: where the talk is. */
  | { t: 'remote-state'; state: RemoteState }
  /** To a slides link: the presenter's file, to play, pause or move to match. */
  | { t: 'remote-media'; media: RemoteMedia }
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
      /**
       * `read-only`: an edit from someone who may not edit, dropped. The socket stays.
       * `waiting`: a remote control or slides link whose presenter is not connected, or
       * whose key the room has not been given yet; it tries again.
       * `ended`: a link from a presentation that has ended; it stops.
       * `too-many`: far more messages than any page sends (Phase 18); the socket is
       * closed, and the page reconnects after a pause and syncs what it had.
       */
      code:
        | 'unauthorised'
        | 'not-found'
        | 'bad-request'
        | 'read-only'
        | 'revoked'
        | 'waiting'
        | 'ended'
        | 'too-many';
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
