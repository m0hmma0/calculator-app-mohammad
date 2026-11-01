import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import {
  colorFor,
  FRAME,
  FrameAssembler,
  frame,
  splitFrame,
  type ClientMessage,
  type HistoryCheckpoint,
  type PeerIdentity,
  type ServerMessage,
} from '@shared/collab';
import { isOnlyAnswers } from '@shared/answers';
import { fileIdsInDoc, searchTextInDoc } from '@shared/files';
import { atLeast, boardAccess, type Role, type Viewer } from './access';
import { AuthError, verifyIdToken } from './auth';
import { boardFilesUpdate } from './db';
import type { Env } from './env';

/** What survives hibernation for each socket. Kept small: the limit is 2 KB. */
interface Attachment {
  session: string;
  user: PeerIdentity | null;
  /** What they may do. Rechecked whenever sharing changes or a link runs out. */
  role: Role | null;
  /** Who they are to the access rule — null for a guest — and the link they used. */
  viewer: Viewer | null;
  link: string | null;
  /** Which open page this is, as the page says: its reconnections replace it. */
  tab: string | null;
  /** When the socket opened, for telling a quiet window from a vanished one. */
  joinedAt: number;
}

/** Take a full snapshot after this many updates, so loading never replays thousands. */
const SNAPSHOT_EVERY = 200;
/** Write the board to R2 and D1 this long after the last change. */
const PERSIST_DELAY_MS = 2000;
/**
 * Changes are written to the log at most this often, as one entry per person. Typing
 * arrives a letter at a time and every entry costs rows, so they are gathered; they are
 * still passed on to everyone the moment they arrive, and only the sender's "saved"
 * (the ack) waits for the write.
 */
const FLUSH_MS = 1000;
/** SQLite rows top out at 2 MB; blobs are split well below that. */
const BLOB_PART_BYTES = 1024 * 1024;
const MAX_PRESENCE_BYTES = 16 * 1024;
/**
 * A window pings every 10 seconds (a hidden tab's timers may slow to once a minute).
 * One silent for this long has gone without saying so — a laptop shut, a network
 * lost — and is dropped, so it stops showing as someone on the board.
 */
const STALE_MS = 3 * 60_000;

const BLOB_UPDATE = 0;
const BLOB_SNAPSHOT = 1;

/**
 * One room per board. It holds the live Yjs document in memory, every socket open on
 * the board, and — in its own SQLite storage — an append-only log of every change
 * plus periodic full snapshots. The log is what version history is built from; the
 * snapshots keep loading fast.
 *
 * Sockets are accepted through the hibernation API, so an idle board costs nothing:
 * the object can be evicted while sockets stay open, and is rebuilt from storage by
 * the constructor when the next message arrives.
 */
export class BoardRoom extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private doc = new Y.Doc();
  private sinceSnapshot = 0;
  /** Changes applied and passed on but not yet written, by who made them. */
  private held = new Map<string, Uint8Array[]>();
  /** A socket for each held change, owed its ack once the change is written. */
  private owed: WebSocket[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly assemblers = new Map<string, FrameAssembler>();
  private chunkId = 0;
  private lastSweep = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, uid TEXT
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq INTEGER NOT NULL, at INTEGER NOT NULL, name TEXT
      );
      CREATE TABLE IF NOT EXISTS blobs (
        kind INTEGER NOT NULL, owner INTEGER NOT NULL, part INTEGER NOT NULL,
        data BLOB NOT NULL, PRIMARY KEY (kind, owner, part)
      );
    `);
    // Liveness pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.loadFromStorage();
    });
  }

  // ---- storage --------------------------------------------------------------

  private meta(key: string): string | null {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  private putBlob(kind: number, owner: number, data: Uint8Array): void {
    for (let part = 0; part * BLOB_PART_BYTES < data.length || part === 0; part += 1) {
      const slice = data.slice(part * BLOB_PART_BYTES, (part + 1) * BLOB_PART_BYTES);
      this.sql.exec(
        'INSERT INTO blobs (kind, owner, part, data) VALUES (?, ?, ?, ?)',
        kind,
        owner,
        part,
        slice.buffer,
      );
    }
  }

  /** Blobs for one kind, in owner order, with their parts joined back together. */
  private readBlobs(kind: number, fromExclusive: number, toInclusive: number): Uint8Array[] {
    const rows = this.sql
      .exec<{ owner: number; data: ArrayBuffer }>(
        `SELECT owner, data FROM blobs WHERE kind = ? AND owner > ? AND owner <= ?
         ORDER BY owner, part`,
        kind,
        fromExclusive,
        toInclusive,
      )
      .toArray();

    const joined: Uint8Array[] = [];
    let current: number | null = null;
    let parts: Uint8Array[] = [];
    const flush = () => {
      if (parts.length === 0) return;
      const length = parts.reduce((sum, part) => sum + part.length, 0);
      const whole = new Uint8Array(length);
      let offset = 0;
      for (const part of parts) {
        whole.set(part, offset);
        offset += part.length;
      }
      joined.push(whole);
      parts = [];
    };
    for (const row of rows) {
      if (row.owner !== current) {
        flush();
        current = row.owner;
      }
      parts.push(new Uint8Array(row.data));
    }
    flush();
    return joined;
  }

  private latestSnapshotAtOrBefore(seq: number): { id: number; seq: number } | null {
    return (
      this.sql
        .exec<{ id: number; seq: number }>(
          'SELECT id, seq FROM snapshots WHERE seq <= ? ORDER BY seq DESC, id DESC LIMIT 1',
          seq,
        )
        .toArray()[0] ?? null
    );
  }

  private lastSeq(): number {
    const row = this.sql
      .exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM updates')
      .toArray()[0];
    return row?.seq ?? 0;
  }

  /** Rebuilds a document as it stood after update `seq`. */
  private docAt(seq: number): Y.Doc {
    const doc = new Y.Doc();
    const snapshot = this.latestSnapshotAtOrBefore(seq);
    const base = snapshot?.seq ?? 0;
    if (snapshot) {
      const [state] = this.readBlobs(BLOB_SNAPSHOT, snapshot.id - 1, snapshot.id);
      if (state) Y.applyUpdate(doc, state);
    }
    for (const update of this.readBlobs(BLOB_UPDATE, base, seq)) Y.applyUpdate(doc, update);
    return doc;
  }

  private loadFromStorage(): void {
    this.doc.destroy();
    const last = this.lastSeq();
    this.doc = this.docAt(last);
    const snapshot = this.latestSnapshotAtOrBefore(last);
    this.sinceSnapshot = last - (snapshot?.seq ?? 0);
  }

  private takeSnapshot(name: string | null): void {
    const seq = this.lastSeq();
    const cursor = this.sql.exec<{ id: number }>(
      'INSERT INTO snapshots (seq, at, name) VALUES (?, ?, ?) RETURNING id',
      seq,
      Date.now(),
      name,
    );
    const id = cursor.one().id;
    this.putBlob(BLOB_SNAPSHOT, id, Y.encodeStateAsUpdate(this.doc));
    this.sinceSnapshot = 0;
  }

  /** Records one change. Returns what was new, or null if the room already had it all. */
  private record(update: Uint8Array, uid: string): Uint8Array | null {
    // Only what was actually new is kept: a reconnecting browser resends plenty that
    // the room already has, and the log should not fill up with echoes.
    const changes: Uint8Array[] = [];
    const capture = (change: Uint8Array) => changes.push(change);
    this.doc.on('update', capture);
    try {
      Y.applyUpdate(this.doc, update, 'peer');
    } finally {
      this.doc.off('update', capture);
    }
    if (changes.length === 0) return null;
    const effective = changes.length === 1 ? changes[0]! : Y.mergeUpdates(changes);

    const theirs = this.held.get(uid);
    if (theirs) theirs.push(effective);
    else this.held.set(uid, [effective]);
    this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
    return effective;
  }

  /**
   * Writes what is held — one log entry per person — and then sends the acks it held
   * back. Called by its timer, and at once before anything reads the log (history, a
   * named version) and whenever a socket goes, so nothing waits on a timer that a
   * room put to sleep might never run.
   */
  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.held.size > 0) {
      for (const [uid, updates] of this.held) {
        const seq = this.sql
          .exec<{ seq: number }>(
            'INSERT INTO updates (at, uid) VALUES (?, ?) RETURNING seq',
            Date.now(),
            uid,
          )
          .one().seq;
        this.putBlob(
          BLOB_UPDATE,
          seq,
          updates.length === 1 ? updates[0]! : Y.mergeUpdates(updates),
        );
        this.sinceSnapshot += 1;
      }
      this.held.clear();
      if (this.sinceSnapshot >= SNAPSHOT_EVERY) this.takeSnapshot(null);
      // Read before written: each write is billed.
      if (!this.meta('dirty')) this.setMeta('dirty', '1');
      void this.scheduleAlarm(Date.now() + PERSIST_DELAY_MS);
    }
    const owed = this.owed;
    this.owed = [];
    for (const socket of owed) this.sendJson(socket, { t: 'ack' });
  }

  /**
   * A board from before Phase 7 — or a fresh duplicate — has its content in R2 but
   * nothing here yet. The first connection brings it in as the starting snapshot.
   */
  private async seedFromR2(boardId: string): Promise<void> {
    if (this.meta('seeded')) return;
    const object = await this.env.FILES.get(`boards/${boardId}/snapshot.bin`);
    // Another request may have seeded while this one waited on R2.
    if (this.meta('seeded')) return;
    if (object && this.lastSeq() === 0) {
      const state = new Uint8Array(await object.arrayBuffer());
      Y.applyUpdate(this.doc, state);
      const id = this.sql
        .exec<{ id: number }>(
          'INSERT INTO snapshots (seq, at, name) VALUES (0, ?, ?) RETURNING id',
          Date.now(),
          'Before live editing',
        )
        .one().id;
      this.putBlob(BLOB_SNAPSHOT, id, Y.encodeStateAsUpdate(this.doc));
    }
    this.setMeta('seeded', '1');
    if (!this.meta('created')) this.setMeta('created', String(Date.now()));
  }

  /** One alarm serves two jobs — saving and rechecking access — so it fires at the sooner. */
  private async scheduleAlarm(at: number): Promise<void> {
    const pending = await this.ctx.storage.getAlarm();
    if (pending === null || at < pending) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    this.flush();
    if (this.meta('dirty')) {
      this.sql.exec("DELETE FROM meta WHERE key = 'dirty'");
      await this.persist();
    }
    const recheckAt = Number(this.meta('recheckAt') ?? 0);
    if (recheckAt && recheckAt <= Date.now()) {
      this.sql.exec("DELETE FROM meta WHERE key = 'recheckAt'");
      await this.reauthorize();
    } else if (recheckAt) {
      await this.scheduleAlarm(recheckAt);
    }
  }

  /**
   * Writes the board where the rest of the app looks for it: the snapshot in R2 (for
   * duplicates and the first load of a new room), and in D1 the words to search by
   * and the images it uses.
   */
  private async persist(): Promise<void> {
    const boardId = this.meta('boardId');
    if (!boardId) return;
    const key = `boards/${boardId}/snapshot.bin`;
    await this.env.FILES.put(key, Y.encodeStateAsUpdate(this.doc));

    await this.env.DB.batch([
      this.env.DB.prepare(
        'UPDATE boards SET snapshot_key = ?1, search_text = ?2, updated_at = ?3 WHERE id = ?4',
      ).bind(key, searchTextInDoc(this.doc), Date.now(), boardId),
      ...(await boardFilesUpdate(this.env, boardId, fileIdsInDoc(this.doc))),
    ]);
  }

  // ---- sockets --------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const boardId = request.headers.get('x-board-id');

    // Sharing changed somewhere above this board: everyone connected is checked again.
    if (url.pathname === '/reauthorize') {
      await this.reauthorize();
      return new Response(null, { status: 204 });
    }

    // Something everyone here should hear about — comments changed, say.
    if (url.pathname === '/notify') {
      const message = (await request.json().catch(() => null)) as ServerMessage | null;
      if (message) for (const socket of this.others(null)) this.sendJson(socket, message);
      return new Response(null, { status: 204 });
    }

    // The board was emptied from the trash: nothing of it should outlive that.
    if (url.pathname === '/destroy') {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.held.clear();
      this.owed = [];
      await this.ctx.storage.deleteAlarm();
      for (const socket of this.ctx.getWebSockets()) socket.close(4404, 'Board deleted');
      await this.ctx.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket' || !boardId) {
      return new Response('Expected a WebSocket', { status: 426 });
    }

    if (!this.meta('boardId')) this.setMeta('boardId', boardId);
    await this.seedFromR2(boardId);

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = {
      session: crypto.randomUUID().slice(0, 12),
      user: null,
      role: null,
      viewer: null,
      link: null,
      tab: null,
      joinedAt: Date.now(),
    };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private attachment(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private sendJson(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // A socket that closed mid-send is cleaned up by its close handler.
    }
  }

  private sendBinary(ws: WebSocket, data: Uint8Array<ArrayBuffer>): void {
    this.chunkId = (this.chunkId + 1) >>> 0;
    try {
      for (const part of splitFrame(data, this.chunkId)) ws.send(part);
    } catch {
      // As above.
    }
  }

  /** Everyone signed in on this board, except `except`. */
  private others(except: WebSocket | null): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws !== except &&
          ws.readyState === WebSocket.READY_STATE_OPEN &&
          this.attachment(ws).user !== null,
      );
  }

  /** How long a window may stay silent before it counts as gone. */
  private staleAfter(): number {
    return Number(this.env.PEER_STALE_MS) || STALE_MS;
  }

  /**
   * Drops sockets that have stopped pinging. Pings are answered without waking the
   * room, so this runs when something else does wake it — anyone moving, typing or
   * arriving — and at most every few seconds.
   */
  private sweep(): void {
    const now = Date.now();
    const staleAfter = this.staleAfter();
    if (now - this.lastSweep < Math.min(15_000, staleAfter / 2)) return;
    this.lastSweep = now;
    for (const ws of this.ctx.getWebSockets()) {
      const { joinedAt } = this.attachment(ws);
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      if (now - Math.max(joinedAt ?? now, pinged) > staleAfter) this.leave(ws);
    }
  }

  private refuse(
    ws: WebSocket,
    code: 'unauthorised' | 'not-found' | 'bad-request' | 'revoked',
    message: string,
  ) {
    this.sendJson(ws, { t: 'error', code, message });
    const close = { 'not-found': 4404, unauthorised: 4401, 'bad-request': 4400, revoked: 4403 };
    ws.close(close[code], message);
  }

  private async canExport(role: Role): Promise<boolean> {
    if (atLeast(role, 'editor')) return true;
    const row = await this.env.DB.prepare('SELECT viewer_export FROM boards WHERE id = ?1')
      .bind(this.meta('boardId'))
      .first<{ viewer_export: number }>();
    return row?.viewer_export === 1;
  }

  /**
   * Runs the access rule again for everyone connected. Anyone who has lost access is
   * told and disconnected; anyone whose role changed is told the new one. Also notes
   * when the soonest link in use runs out, so that is checked again on time.
   */
  private async reauthorize(): Promise<void> {
    const boardId = this.meta('boardId');
    if (!boardId) return;
    let soonest: number | null = null;

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = this.attachment(ws);
      if (!attachment.user) continue;
      const access = await boardAccess(this.env, attachment.viewer, boardId, attachment.link);
      if (!access.role) {
        this.refuse(ws, 'revoked', 'Your access to this board has been removed');
        continue;
      }
      if (access.expiresAt !== null) soonest = Math.min(soonest ?? Infinity, access.expiresAt);
      if (access.role !== attachment.role) {
        ws.serializeAttachment({ ...attachment, role: access.role });
        this.sendJson(ws, {
          t: 'role',
          role: access.role,
          canExport: await this.canExport(access.role),
        });
        // Newly able to edit: the room asks for anything they did while they could not.
        if (atLeast(access.role, 'editor') && !atLeast(attachment.role, 'editor')) {
          this.sendBinary(ws, frame(FRAME.SYNC_STEP1, Y.encodeStateVector(this.doc)));
        }
      } else {
        // Export may have been switched without the role changing.
        this.sendJson(ws, {
          t: 'role',
          role: access.role,
          canExport: await this.canExport(access.role),
        });
      }
    }
    await this.noteExpiry(soonest);
  }

  private async noteExpiry(at: number | null): Promise<void> {
    if (at === null) return;
    const current = Number(this.meta('recheckAt') ?? 0);
    if (current && current <= at) return;
    this.setMeta('recheckAt', String(at + 250));
    await this.scheduleAlarm(at + 250);
  }

  /**
   * The handshake. A socket can do nothing until it says who it is: a token the room
   * can verify, or — for a guest — no token and a share link. The same access rule
   * as every API route decides what, if anything, they may do here.
   */
  private async authenticate(
    ws: WebSocket,
    message: Extract<ClientMessage, { t: 'auth' }>,
  ): Promise<void> {
    let account = null;
    if (message.token) {
      try {
        account = await verifyIdToken(message.token, this.env);
      } catch (error) {
        if (error instanceof AuthError) return this.refuse(ws, 'unauthorised', error.message);
        throw error;
      }
    }

    const link =
      typeof message.link === 'string' && /^[\w-]{16,64}$/.test(message.link) ? message.link : null;
    const viewer: Viewer | null = account
      ? { uid: account.uid, email: account.email.toLowerCase() }
      : null;
    const access = await boardAccess(this.env, viewer, this.meta('boardId') ?? '', link);
    if (!access.role) {
      // A guest turned away may simply need to sign in; anyone else is not let in.
      return account
        ? this.refuse(ws, 'not-found', 'That board is not available')
        : this.refuse(ws, 'unauthorised', 'Sign in to open this board');
    }

    const guestId =
      String(message.guest?.id ?? '')
        .replace(/[^\w-]/g, '')
        .slice(0, 32) || 'anon';
    const guestName = String(message.guest?.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    const user: PeerIdentity = account
      ? {
          uid: account.uid,
          name: account.name ?? account.email,
          picture: account.picture,
          color: colorFor(account.uid),
        }
      : {
          uid: `guest:${guestId}`,
          name: `${guestName || 'Guest'} (guest)`,
          picture: null,
          color: colorFor(`guest:${guestId}`),
        };
    const tab =
      typeof message.tab === 'string' && /^[\w-]{8,64}$/.test(message.tab) ? message.tab : null;
    const attachment: Attachment = {
      ...this.attachment(ws),
      user,
      role: access.role,
      viewer,
      link,
      tab,
    };
    ws.serializeAttachment(attachment);
    await this.noteExpiry(access.expiresAt);

    // The same page connecting again — after its network dropped, say — replaces its
    // earlier socket, which may never have said goodbye. Only this person's own.
    if (tab) {
      for (const other of this.others(ws)) {
        const earlier = this.attachment(other);
        if (earlier.tab === tab && earlier.user?.uid === user.uid) this.leave(other);
      }
    }
    this.lastSweep = 0;
    this.sweep();

    const peers = this.others(ws).map((other) => {
      const { session, user: peer } = this.attachment(other);
      return { session, user: peer! };
    });
    this.sendJson(ws, {
      t: 'ready',
      session: attachment.session,
      you: user,
      role: access.role,
      now: Date.now(),
      peers,
    });
    this.sendJson(ws, {
      t: 'role',
      role: access.role,
      canExport: await this.canExport(access.role),
    });
    for (const other of this.others(ws)) {
      this.sendJson(other, { t: 'join', session: attachment.session, user });
    }
    // The room asks for what it is missing, too: that is how offline work comes in, and
    // how changes it held but never wrote (it restarted within FLUSH_MS) come back.
    // Answers too, judged like any other; not from a viewer, whose nothing it accepts.
    if (atLeast(access.role, 'editor') || access.role === 'answer') {
      this.sendBinary(ws, frame(FRAME.SYNC_STEP1, Y.encodeStateVector(this.doc)));
    }
  }

  private history(ws: WebSocket): void {
    const checkpoints = this.sql
      .exec<{ seq: number; at: number; name: string | null }>(
        'SELECT seq, at, name FROM snapshots WHERE name IS NOT NULL ORDER BY seq, id',
      )
      .toArray()
      .map((row): HistoryCheckpoint => ({ seq: row.seq, at: row.at, name: row.name }));
    const last = this.lastSeq();
    const lastAt =
      this.sql.exec<{ at: number }>('SELECT at FROM updates WHERE seq = ?', last).toArray()[0]
        ?.at ?? Date.now();
    this.sendJson(ws, {
      t: 'history',
      first: 0,
      last,
      firstAt: Number(this.meta('created') ?? Date.now()),
      lastAt,
      checkpoints,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const { session, user, role } = this.attachment(ws);
    this.sweep();

    if (typeof message === 'string') {
      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(message) as ClientMessage;
      } catch {
        return this.refuse(ws, 'bad-request', 'Unreadable message');
      }

      if (!user) {
        if (parsed.t === 'auth' && typeof parsed.token === 'string') {
          return this.authenticate(ws, parsed);
        }
        return this.refuse(ws, 'unauthorised', 'Sign in first');
      }

      switch (parsed.t) {
        case 'presence': {
          if (message.length > MAX_PRESENCE_BYTES) return;
          const relay = JSON.stringify({ t: 'presence', session, user, state: parsed.state });
          for (const other of this.others(ws)) {
            try {
              other.send(relay);
            } catch {
              // Closed; its own handler tidies up.
            }
          }
          return;
        }
        // History is for people who can restore from it.
        case 'history':
          if (!atLeast(role, 'editor')) return;
          this.flush();
          return this.history(ws);
        case 'history-state': {
          if (!atLeast(role, 'editor')) return;
          this.flush();
          const seq = Math.max(0, Math.min(Math.floor(Number(parsed.seq)) || 0, this.lastSeq()));
          const past = this.docAt(seq);
          const at =
            this.sql.exec<{ at: number }>('SELECT at FROM updates WHERE seq = ?', seq).toArray()[0]
              ?.at ?? Number(this.meta('created') ?? Date.now());
          this.sendJson(ws, { t: 'history-state', req: parsed.req, seq, at });
          // [HISTORY][request id u32][state], so a slow answer cannot be mistaken for
          // the one the scrubber is waiting on now.
          const state = Y.encodeStateAsUpdate(past);
          past.destroy();
          const body = new Uint8Array(4 + state.length);
          new DataView(body.buffer).setUint32(0, parsed.req >>> 0);
          body.set(state, 4);
          this.sendBinary(ws, frame(FRAME.HISTORY, body));
          return;
        }
        case 'checkpoint': {
          if (!atLeast(role, 'editor')) return;
          const name = String(parsed.name ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
          if (!name) return;
          this.flush();
          this.takeSnapshot(name);
          for (const socket of [ws, ...this.others(ws)]) this.history(socket);
          return;
        }
        default:
          return;
      }
    }

    if (!user) return this.refuse(ws, 'unauthorised', 'Sign in first');

    let assembler = this.assemblers.get(session);
    if (!assembler) {
      assembler = new FrameAssembler();
      this.assemblers.set(session, assembler);
    }
    const data = assembler.accept(new Uint8Array(message));
    if (!data) return;
    const payload = data.subarray(1);

    switch (data[0]) {
      case FRAME.SYNC_STEP1:
        this.sendBinary(ws, frame(FRAME.SYNC_STEP2, Y.encodeStateAsUpdate(this.doc, payload)));
        return;
      case FRAME.SYNC_STEP2:
      case FRAME.UPDATE: {
        // The gate. Hiding the toolbar from a viewer is a courtesy; this is the rule.
        // Their change is not applied, not stored and not passed on, and they are told.
        // Someone who answers gets through only with words typed in placeholders.
        const answering = role === 'answer' && isOnlyAnswers(this.doc, payload);
        if (!atLeast(role, 'editor') && !answering) {
          this.sendJson(ws, {
            t: 'error',
            code: 'read-only',
            message:
              role === 'answer'
                ? 'You can answer in the placeholders, but not change anything else'
                : 'You can view this board but not change it',
          });
          return;
        }
        let effective: Uint8Array | null;
        try {
          effective = this.record(payload, user.uid);
        } catch {
          return this.refuse(ws, 'bad-request', 'That change could not be applied');
        }
        if (effective) {
          const out = frame(FRAME.UPDATE, effective);
          for (const other of this.others(ws)) this.sendBinary(other, out);
          // Saved once it is written, within FLUSH_MS.
          this.owed.push(ws);
        } else {
          this.sendJson(ws, { t: 'ack' });
        }
        return;
      }
      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  private leave(ws: WebSocket): void {
    // A page closing may be the last thing this room hears for a while.
    this.flush();
    const { session, user } = this.attachment(ws);
    this.assemblers.delete(session);
    try {
      ws.close(1000, 'Bye');
    } catch {
      // Already closed.
    }
    if (!user) return;
    for (const other of this.others(ws)) this.sendJson(other, { t: 'leave', session });
  }
}
