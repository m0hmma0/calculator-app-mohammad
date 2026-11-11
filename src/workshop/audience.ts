import * as Y from 'yjs';
import { usePresence } from '@/collab/presence';
import { laserAlive, laserSnapshot, onLaserChange } from '@/laser/laserTrail';
import { boardDoc, useBoardStore } from '@/state/boardStore';
import { useEmbeds } from '@/state/embedStore';
import { audienceUrl } from './audienceMode';
import { usePresentation } from './presentation';

/**
 * Presenter view, from the presenter's side: the audience window, opened beside this
 * one, and everything it is sent. The audience window shows the slide on show and
 * nothing else; this window keeps the controls, the notes and the board.
 *
 * Everything goes over a BroadcastChannel between the two windows of this browser —
 * the document as updates, the slide, the laser, what the media are doing — so it
 * works the same on the signed-out board, a guest's and an account's, and sends
 * nothing to the server.
 */

/** A laser point, by how long ago it was drawn: the two windows' clocks differ. */
export interface SentPoint {
  x: number;
  y: number;
  age: number;
}

export interface SentTrail {
  points: SentPoint[];
  lifetimeMs: number;
  /** Someone else's laser, in their colour; the presenter's own has none. */
  color?: string;
}

export type ToAudience =
  | {
      t: 'state';
      title: string;
      page: string;
      /** The frame on show; null between presentations. */
      frame: string | null;
      /** The room's clock less this one's, so celebrations are fresh there too. */
      clockOffset: number;
      /** Other sites' players started here, which start there instead. */
      started: readonly string[];
    }
  | { t: 'doc'; update: Uint8Array }
  | { t: 'laser'; trails: SentTrail[] }
  | { t: 'media'; id: string; playing: boolean; time: number; rate: number }
  | { t: 'close' };

export type FromAudience =
  | { t: 'hello' }
  | { t: 'gone' }
  /** The browser would not let a sound play there unasked: it plays here instead. */
  | { t: 'media-blocked'; id: string };

/** How often a playing video's time is sent, so the two never drift apart for long. */
const MEDIA_SYNC_MS = 1000;

interface Open {
  window: Window;
  channel: BroadcastChannel;
  stop: () => void;
}

let open: Open | null = null;

const newChannelName = () =>
  `aud-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** The board's name, for the audience window's title (what a screen-share picker lists). */
const titleOf = () => document.title.replace(/ · Sabboura$/, '') || 'Slides';

/**
 * Opens the audience window and starts feeding it. Must run inside the click that
 * asked for it, or the browser blocks the window. False when it was blocked.
 */
export function openAudienceWindow(): boolean {
  if (open && !open.window.closed) {
    open.window.focus();
    return true;
  }
  const name = newChannelName();
  const opened = window.open(
    audienceUrl(name),
    'sabboura-audience',
    `popup,width=${Math.round(screen.availWidth * 0.6)},height=${Math.round(screen.availHeight * 0.6)}`,
  );
  if (!opened) return false;
  const channel = new BroadcastChannel(name);
  open = { window: opened, channel, stop: feed(channel, opened) };
  usePresentation.setState({ audience: true, heardHere: [], audienceSince: Date.now() });
  return true;
}

/** Closes the audience window, if it is open. Presenting carries on here. */
export function closeAudienceWindow(): void {
  if (!open) return;
  const { window: opened, channel, stop } = open;
  open = null;
  stop();
  try {
    channel.postMessage({ t: 'close' } satisfies ToAudience);
  } catch {
    // Already closed.
  }
  channel.close();
  if (!opened.closed) opened.close();
  usePresentation.setState({ audience: false, heardHere: [], audienceSince: null });
}

/** Wires one open audience window up; returns how to stop. */
function feed(channel: BroadcastChannel, opened: Window): () => void {
  const post = (message: ToAudience) => {
    try {
      channel.postMessage(message);
    } catch {
      // Closed under us; the watch below tidies up.
    }
  };

  const state = (): ToAudience => {
    const presentation = usePresentation.getState();
    return {
      t: 'state',
      title: titleOf(),
      page: useBoardStore.getState().page,
      frame: presentation.presenting ? presentation.frame : null,
      clockOffset: usePresence.getState().clockOffset,
      started: useEmbeds.getState().started,
    };
  };

  // The document: all of it when the window says hello, then each change as made.
  let doc: Y.Doc = boardDoc().doc;
  const onUpdate = (update: Uint8Array) => post({ t: 'doc', update });
  doc.on('update', onUpdate);

  const sendMedia = (media: HTMLMediaElement) => {
    const id = media.dataset.elementId;
    if (!id) return;
    post({
      t: 'media',
      id,
      playing: !media.paused && !media.ended,
      time: media.currentTime,
      rate: media.playbackRate,
    });
  };
  const playingMedia = () =>
    [
      ...document.querySelectorAll<HTMLMediaElement>(
        'video[data-element-id], audio[data-element-id]',
      ),
    ].filter((media) => !media.paused);

  const onMessage = (event: MessageEvent<FromAudience>) => {
    const message = event.data;
    if (message.t === 'hello') {
      if (boardDoc().doc !== doc) {
        doc.off('update', onUpdate);
        doc = boardDoc().doc;
        doc.on('update', onUpdate);
      }
      post(state());
      post({ t: 'doc', update: Y.encodeStateAsUpdate(doc) });
      for (const media of playingMedia()) sendMedia(media);
    } else if (message.t === 'gone') {
      closeAudienceWindow();
    } else if (message.t === 'media-blocked') {
      const { heardHere } = usePresentation.getState();
      if (!heardHere.includes(message.id)) {
        usePresentation.setState({ heardHere: [...heardHere, message.id] });
      }
    }
  };
  channel.addEventListener('message', onMessage);

  // The slide, the page and the players started: whenever any of them changes.
  let last = '';
  const sendState = () => {
    const next = state();
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    post(next);
  };
  const stops = [
    usePresentation.subscribe(sendState),
    useBoardStore.subscribe((now, before) => {
      if (now.page !== before.page) sendState();
    }),
    useEmbeds.subscribe(sendState),
  ];

  // The laser — this person's, and anyone else's on the board — frame by frame while
  // any of it is still fading.
  let laserFrame = 0;
  const peersWithLaser = () =>
    Object.values(usePresence.getState().peers).filter((peer) => peer.laser !== null);
  const sendLaser = () => {
    laserFrame = 0;
    const now = performance.now();
    const own = laserSnapshot(now);
    const trails: SentTrail[] = [];
    const toSent = (points: readonly { x: number; y: number; at: number }[]) =>
      points.map((point) => ({ x: point.x, y: point.y, age: Math.round(now - point.at) }));
    if (own.points.length > 0) {
      trails.push({ points: toSent(own.points), lifetimeMs: own.lifetimeMs });
    }
    for (const peer of peersWithLaser()) {
      trails.push({
        points: toSent(peer.laser!.points),
        lifetimeMs: peer.laser!.lifetimeMs,
        color: peer.user.color,
      });
    }
    post({ t: 'laser', trails });
    if (laserAlive() || trails.length > 0) laserFrame = requestAnimationFrame(sendLaser);
  };
  const wakeLaser = () => {
    if (laserFrame === 0) laserFrame = requestAnimationFrame(sendLaser);
  };
  stops.push(onLaserChange(wakeLaser));
  stops.push(
    usePresence.subscribe((now, before) => {
      if (now.peers !== before.peers) wakeLaser();
      if (now.clockOffset !== before.clockOffset) sendState();
    }),
  );

  // Video and sound files: played, paused or moved here, the same there. Media events
  // do not bubble, so they are caught on the way down.
  const lastSent = new Map<string, number>();
  const onMediaEvent = (event: Event) => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement) || !media.dataset.elementId) return;
    if (event.type === 'timeupdate') {
      const at = lastSent.get(media.dataset.elementId) ?? 0;
      if (performance.now() - at < MEDIA_SYNC_MS) return;
    }
    lastSent.set(media.dataset.elementId, performance.now());
    sendMedia(media);
  };
  const MEDIA_EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'ended', 'timeupdate'];
  for (const type of MEDIA_EVENTS) document.addEventListener(type, onMediaEvent, true);

  // Closed by hand: presenter view ends, presenting carries on.
  const watch = setInterval(() => {
    if (opened.closed) closeAudienceWindow();
  }, 500);
  // This page going away takes the audience window with it.
  const onLeave = () => closeAudienceWindow();
  window.addEventListener('pagehide', onLeave);

  return () => {
    doc.off('update', onUpdate);
    channel.removeEventListener('message', onMessage);
    for (const stop of stops) stop();
    if (laserFrame !== 0) cancelAnimationFrame(laserFrame);
    for (const type of MEDIA_EVENTS) document.removeEventListener(type, onMediaEvent, true);
    clearInterval(watch);
    window.removeEventListener('pagehide', onLeave);
  };
}

/**
 * Whether a video or sound is silent in this window: while the audience window is
 * open it is heard there, unless that window could not play it.
 */
export function useMutedHere(id: string): boolean {
  return usePresentation((state) => state.audience && !state.heardHere.includes(id));
}
