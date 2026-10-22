import * as Y from 'yjs';
import {
  FRAME,
  FrameAssembler,
  frame,
  splitFrame,
  type ClientMessage,
  type PresenceState,
  type ServerMessage,
} from '@shared/collab';
import { currentIdToken } from '@/auth/session';
import { REMOTE_ORIGIN, type BoardDoc } from '@/doc/board';

export type ConnectionStatus =
  /** First attempt, not yet in sync. */
  | 'connecting'
  /** Signed in and in sync; edits flow both ways. */
  | 'connected'
  /** Was connected, lost it, trying again. Edits keep landing locally. */
  | 'reconnecting'
  /** The browser says there is no network. Waiting for it to come back. */
  | 'offline'
  /** The room said no: not signed in, or not this person's board. */
  | 'refused';

export interface RoomEvents {
  status: (status: ConnectionStatus) => void;
  message: (message: ServerMessage) => void;
  /** A past state of the board, answering a history request. */
  history: (req: number, state: Uint8Array) => void;
  /** The first full exchange with the room has finished. */
  synced: () => void;
}

/** Local edits are gathered for this long and sent as one update. */
const BATCH_MS = 30;
/**
 * How often the room is asked "still there?", and how long an answer may take. A
 * socket whose network has quietly gone — wifi off with no "offline" event from the
 * system, a laptop lid closed — still looks open; only a missing answer shows it.
 */
const PING_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
/** A connection that opens but never gets as far as "ready" is retried after this. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [300, 1000, 2000, 4000, 8000, 15_000];

/**
 * One board's live connection. It keeps no state the document does not already
 * have: on every (re)connect the browser and the room exchange state vectors and send
 * each other whatever the other is missing. That single exchange is both "catch up"
 * and "merge what I did offline" — there is no separate queue of offline edits to
 * replay, and so nothing to lose.
 */
export class RoomConnection {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'connecting';
  private ready = false;
  private everConnected = false;
  private stopped = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private batch: Uint8Array[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private unacked = 0;
  private settled: Array<() => void> = [];
  private assembler = new FrameAssembler();
  private chunkId = 0;

  constructor(
    private readonly doc: BoardDoc,
    private readonly boardId: string,
    private readonly on: RoomEvents,
  ) {}

  start(): void {
    this.doc.doc.on('update', this.onLocalUpdate);
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('focus', this.onReturn);
    document.addEventListener('visibilitychange', this.onReturn);
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.doc.doc.off('update', this.onLocalUpdate);
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('focus', this.onReturn);
    document.removeEventListener('visibilitychange', this.onReturn);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.stopPing();
    this.ws?.close(1000, 'Leaving');
    this.ws = null;
    this.resolveSettled();
  }

  send(message: ClientMessage): void {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  sendPresence(state: PresenceState): void {
    this.send({ t: 'presence', state });
  }

  /** Sends anything batched and waits — briefly — for the room to confirm it stored it. */
  async flush(timeoutMs = 3000): Promise<void> {
    this.sendBatch();
    if (this.unacked === 0 || !this.ready) return;
    await Promise.race([
      new Promise<void>((resolve) => this.settled.push(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  /** Whether every local change has been stored by the room. */
  get allSaved(): boolean {
    return this.ready && this.unacked === 0 && this.batch.length === 0;
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.on.status(status);
  }

  private connect(): void {
    if (this.stopped) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.setStatus('offline');
      return;
    }
    this.setStatus(this.everConnected ? 'reconnecting' : 'connecting');

    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/boards/${this.boardId}/room`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.ready = false;
    this.assembler = new FrameAssembler();

    ws.onopen = async () => {
      // A refreshed token if the old one has expired; Firebase handles that.
      const token = await currentIdToken(this.attempts > 0);
      if (ws !== this.ws) return;
      ws.send(JSON.stringify({ t: 'auth', token: token ?? '' } satisfies ClientMessage));
    };
    ws.onmessage = (event) => this.onMessage(ws, event);
    ws.onclose = (event) => this.onClose(ws, event);
    // Cleared by the room's first word; if that never comes, start again.
    this.clearPongTimer();
    this.pongTimer = setTimeout(this.declareDead, HANDSHAKE_TIMEOUT_MS);
  }

  private onMessage(ws: WebSocket, event: MessageEvent): void {
    if (ws !== this.ws) return;
    // Anything at all from the room proves the line is alive.
    this.clearPongTimer();

    if (typeof event.data === 'string') {
      if (event.data === 'pong') return;
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.t === 'ready') {
        this.ready = true;
        this.everConnected = true;
        this.attempts = 0;
        this.unacked = 0;
        this.startPing();
        // Ask for what the room has that this browser does not.
        this.sendBinary(frame(FRAME.SYNC_STEP1, Y.encodeStateVector(this.doc.doc)));
      } else if (message.t === 'ack') {
        this.unacked = Math.max(0, this.unacked - 1);
        if (this.unacked === 0) this.resolveSettled();
      }
      this.on.message(message);
      return;
    }

    const data = this.assembler.accept(new Uint8Array(event.data as ArrayBuffer));
    if (!data) return;
    const payload = data.subarray(1);

    switch (data[0]) {
      case FRAME.SYNC_STEP1:
        // The room asking for what it is missing — offline work, typically.
        this.unacked += 1;
        this.sendBinary(frame(FRAME.SYNC_STEP2, Y.encodeStateAsUpdate(this.doc.doc, payload)));
        return;
      case FRAME.SYNC_STEP2:
        Y.applyUpdate(this.doc.doc, payload, REMOTE_ORIGIN);
        this.setStatus('connected');
        this.on.synced();
        return;
      case FRAME.UPDATE:
        Y.applyUpdate(this.doc.doc, payload, REMOTE_ORIGIN);
        return;
      case FRAME.HISTORY: {
        const req = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
        this.on.history(req, payload.slice(4));
        return;
      }
      default:
        return;
    }
  }

  private onClose(ws: WebSocket, event: CloseEvent): void {
    if (ws !== this.ws) return;
    this.lost(event.code);
  }

  /** The connection is gone, however that was discovered. Try again. */
  private lost(code: number): void {
    this.ws = null;
    this.ready = false;
    this.stopPing();
    this.resolveSettled();
    if (this.stopped) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);

    // 4401: the token was refused. Worth one retry with a fresh token; after that, and
    // for 4404 (not this person's board), stop rather than hammer the room.
    if (code === 4404 || (code === 4401 && this.attempts > 0)) {
      this.setStatus('refused');
      return;
    }

    // The system's "online" flag is a hint, not a promise, so retries continue either
    // way; coming back online just makes the next one happen at once.
    this.setStatus(
      !navigator.onLine ? 'offline' : this.everConnected ? 'reconnecting' : 'connecting',
    );
    const base = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)]!;
    this.attempts += 1;
    // Jitter, so a room that restarts is not hit by everyone in the same instant.
    this.retryTimer = setTimeout(() => this.connect(), base * (0.6 + Math.random() * 0.4));
  }

  /**
   * No answer to a ping: the socket is open in name only. Drop it and reconnect —
   * the browser may not fire its own close event for minutes.
   */
  private readonly declareDead = () => {
    this.pongTimer = null;
    const ws = this.ws;
    if (!ws) return;
    ws.onclose = null;
    ws.onmessage = null;
    try {
      ws.close(4000, 'No answer');
    } catch {
      // Already closing.
    }
    this.lost(4000);
  };

  /** Asks the room whether it is still there, unless a question is already out. */
  private probe(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.pongTimer) return;
    try {
      ws.send('ping');
    } catch {
      this.declareDead();
      return;
    }
    this.pongTimer = setTimeout(this.declareDead, PONG_TIMEOUT_MS);
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private readonly onOnline = () => {
    if (this.stopped) return;
    // A socket that survived the outage is checked rather than trusted.
    if (this.ws) {
      this.probe();
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.attempts = 0;
    this.connect();
  };

  /** Coming back to the tab — or the laptop waking — is when a stale socket shows. */
  private readonly onReturn = () => {
    if (document.visibilityState === 'visible') this.probe();
  };

  /**
   * The browser knows before the socket does. Closing now means the status says so
   * at once, and coming back online reconnects at once instead of waiting out a
   * socket timeout.
   */
  private readonly onOffline = () => {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    this.stopPing();
    if (ws) {
      ws.onclose = null;
      ws.close(1000, 'Offline');
    }
    this.setStatus('offline');
  };

  private readonly onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // What came from the room does not go back to it.
    if (origin === REMOTE_ORIGIN) return;
    // While disconnected nothing is queued: the next sync exchange carries it all.
    if (!this.ready) return;
    this.batch.push(update);
    this.batchTimer ??= setTimeout(() => this.sendBatch(), BATCH_MS);
  };

  private sendBatch(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = null;
    if (this.batch.length === 0 || !this.ready) {
      this.batch = [];
      return;
    }
    const merged = this.batch.length === 1 ? this.batch[0]! : Y.mergeUpdates(this.batch);
    this.batch = [];
    this.unacked += 1;
    this.sendBinary(frame(FRAME.UPDATE, merged));
  }

  private sendBinary(data: Uint8Array<ArrayBuffer>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this.chunkId = (this.chunkId + 1) >>> 0;
    for (const part of splitFrame(data, this.chunkId)) ws.send(part);
  }

  private startPing(): void {
    this.stopPing();
    // Answered by the room without waking it (an auto-response), so an idle board
    // still costs nothing; it also keeps proxies from dropping an idle socket.
    this.pingTimer = setInterval(() => this.probe(), PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearPongTimer();
  }

  private resolveSettled(): void {
    const waiting = this.settled;
    this.settled = [];
    for (const resolve of waiting) resolve();
  }
}
