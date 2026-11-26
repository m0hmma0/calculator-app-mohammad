import * as Y from 'yjs';
import { create } from 'zustand';
import type { RoomConnection } from '@/collab/connection';
import { boardDoc, currentBoardId } from '@/state/boardStore';
import type { RemoteAction, RemoteState, ServerMessage } from '@shared/collab';
import { REMOTE_ACTIONS } from '@shared/collab';
import { stepPresentation, usePresentation } from './presentation';

/**
 * The remote control (Phase 17c, asked for on 20 November): a link the presenter opens
 * on a phone, or in another tab, which shows presenter view there — the slide, the
 * next one, the notes, a clock — and moves the slides here. The link carries a key
 * and nothing else is needed: no sign-in. It works only while this presentation runs.
 *
 * On a board with a room, the room carries it: this page registers the key
 * (`remote-open`), the room lets a remote in with it as a viewer of the board, passes
 * its buttons here (`remote`), and passes this page's `remote-state` to it. On the
 * signed-out board there is no room, so the remote must be another tab of this
 * browser, and a BroadcastChannel carries the same messages and the board itself.
 */

/** Messages on the signed-out board's channel, from the remote to the presenter. */
export type FromRemote = { t: 'hello' } | { t: 'remote'; action: RemoteAction };
/** And from the presenter to the remote. */
export type ToRemote =
  { t: 'doc'; update: Uint8Array } | { t: 'state'; state: RemoteState } | { t: 'end' };

export const remoteChannelName = (key: string) => `sabboura-remote-${key}`;

interface RemoteStore {
  /** The remote control's link while it works, or null. */
  url: string | null;
  /** The slides-only link (26 November): the audience window on any device. */
  watchUrl: string | null;
}

export const useRemote = create<RemoteStore>(() => ({ url: null, watchUrl: null }));

let room: RoomConnection | null = null;
let key: string | null = null;
let watchKey: string | null = null;
let stops: Array<() => void> = [];

/** The board's live connection, while there is one; the remote needs it. */
export function setRemoteRoom(connection: RoomConnection | null): void {
  room = connection;
}

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** A link's address: this page, with the key (and the board) in its hash. */
function linkUrl(kind: 'remote' | 'watch', linkKey: string): string {
  const here = new URL(location.href);
  const boardId = room ? currentBoardId() : null;
  here.hash = boardId ? `${kind}=${linkKey}&b=${boardId}` : `${kind}=${linkKey}`;
  return here.toString();
}

function state(): RemoteState {
  const { frame, audienceSince, startedAt } = usePresentation.getState();
  return { frame, since: audienceSince ?? startedAt };
}

function act(action: RemoteAction): void {
  if (!usePresentation.getState().presenting) return;
  if (action === 'next') stepPresentation(1);
  else if (action === 'previous') stepPresentation(-1);
  else if (action === 'first') stepPresentation(-Infinity);
  else stepPresentation(Infinity);
}

/** The remote control's link (both links are made together, once per presentation). */
export function openRemote(): string {
  openLinks();
  return useRemote.getState().url!;
}

/** The slides-only link. */
export function openWatchLink(): string {
  openLinks();
  return useRemote.getState().watchUrl!;
}

/** On the signed-out board: feeds one link's tabs the board and the slide. */
function channelFor(linkKey: string, controls: boolean): () => void {
  const channel = new BroadcastChannel(remoteChannelName(linkKey));
  const post = (message: ToRemote) => channel.postMessage(message);
  const doc = boardDoc().doc;
  const onUpdate = (update: Uint8Array) => post({ t: 'doc', update });
  doc.on('update', onUpdate);
  channel.onmessage = (event: MessageEvent<FromRemote>) => {
    const message = event.data;
    if (message?.t === 'hello') {
      post({ t: 'doc', update: Y.encodeStateAsUpdate(doc) });
      post({ t: 'state', state: state() });
    } else if (controls && message?.t === 'remote' && REMOTE_ACTIONS.includes(message.action)) {
      act(message.action);
    }
  };
  const stopState = usePresentation.subscribe((now, before) => {
    if (now.frame !== before.frame || now.audienceSince !== before.audienceSince) {
      post({ t: 'state', state: state() });
    }
  });
  return () => {
    stopState();
    doc.off('update', onUpdate);
    post({ t: 'end' });
    channel.close();
  };
}

function openLinks(): void {
  if (key && watchKey) return;
  key = newKey();
  watchKey = newKey();
  const remoteKey = key;
  const slidesKey = watchKey;

  if (room) {
    const connection = room;
    connection.send({ t: 'remote-open', key: remoteKey, watch: slidesKey });
    const sendState = () => connection.send({ t: 'remote-state', state: state() });
    stops.push(
      usePresentation.subscribe((now, before) => {
        if (now.frame !== before.frame || now.audienceSince !== before.audienceSince) sendState();
      }),
    );
  } else {
    stops.push(channelFor(remoteKey, true), channelFor(slidesKey, false));
  }

  useRemote.setState({
    url: linkUrl('remote', remoteKey),
    watchUrl: linkUrl('watch', slidesKey),
  });
}

/** The presentation is over: the link stops working, and remotes are told. */
export function closeRemote(): void {
  if (!key) return;
  room?.send({ t: 'remote-close' });
  for (const stop of stops) stop();
  stops = [];
  key = null;
  watchKey = null;
  useRemote.setState({ url: null, watchUrl: null });
}

/**
 * The room's messages for the presenter: a remote's button, a remote that has just
 * connected (it is told where the talk is), and this page reconnecting (the link is
 * registered again, since the room may have restarted).
 */
export function handleRemoteMessage(message: ServerMessage): void {
  if (!key || !room) return;
  if (message.t === 'remote') {
    if (message.action === 'hello') room.send({ t: 'remote-state', state: state() });
    else if (REMOTE_ACTIONS.includes(message.action)) act(message.action);
  } else if (message.t === 'ready') {
    room.send({ t: 'remote-open', key, watch: watchKey ?? undefined });
    room.send({ t: 'remote-state', state: state() });
  }
}
