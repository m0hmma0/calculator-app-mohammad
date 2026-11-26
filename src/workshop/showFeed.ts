import type { LaserPoint } from '@/laser/laser';
import { laserAlive, laserSnapshot, onLaserChange } from '@/laser/laserTrail';
import type { SentTrail } from './audience';

/**
 * What a slides link is sent besides the board and the slide (26 November): the
 * presenter's video and sound files — played, paused or moved here, the same there —
 * and, on the signed-out board, the presenter's laser frame by frame. (With a room, the
 * laser goes in the presenter's presence, which the room passes on.)
 */

export interface MediaState {
  id: string;
  playing: boolean;
  time: number;
  rate: number;
}

/** How often a playing file's time is sent, so the screens never drift apart for long. */
const MEDIA_SYNC_MS = 1000;
const MEDIA_EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'ended', 'timeupdate'];

function stateOf(media: HTMLMediaElement): MediaState | null {
  const id = media.dataset.elementId;
  if (!id) return null;
  return {
    id,
    playing: !media.paused && !media.ended,
    time: media.currentTime,
    rate: media.playbackRate,
  };
}

/** Every file playing now: told to a screen that has just joined. */
export function playingMedia(): MediaState[] {
  return [
    ...document.querySelectorAll<HTMLMediaElement>(
      'video[data-element-id], audio[data-element-id]',
    ),
  ]
    .filter((media) => !media.paused)
    .map(stateOf)
    .filter((state): state is MediaState => state !== null);
}

/** Sends what the presenter's files do; returns the way to stop. */
export function watchMedia(send: (state: MediaState) => void): () => void {
  const lastSent = new Map<string, number>();
  const onEvent = (event: Event) => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement)) return;
    const state = stateOf(media);
    if (!state) return;
    if (event.type === 'timeupdate') {
      if (performance.now() - (lastSent.get(state.id) ?? 0) < MEDIA_SYNC_MS) return;
    }
    lastSent.set(state.id, performance.now());
    send(state);
  };
  // Media events do not bubble: caught on the way down.
  for (const type of MEDIA_EVENTS) document.addEventListener(type, onEvent, true);
  return () => {
    for (const type of MEDIA_EVENTS) document.removeEventListener(type, onEvent, true);
  };
}

/** Sends this person's laser, frame by frame while any of it is fading. */
export function watchLaser(send: (trails: SentTrail[]) => void): () => void {
  let frame = 0;
  const tick = () => {
    frame = 0;
    const now = performance.now();
    const own = laserSnapshot(now);
    const toSent = (points: readonly LaserPoint[]) =>
      points.map((point) => ({
        x: point.x,
        y: point.y,
        age: Math.round(now - point.at),
        mark: point.mark,
      }));
    send(own.points.length > 0 ? [{ points: toSent(own.points), lifetimeMs: own.lifetimeMs }] : []);
    if (laserAlive()) frame = requestAnimationFrame(tick);
  };
  const stop = onLaserChange(() => {
    if (frame === 0) frame = requestAnimationFrame(tick);
  });
  return () => {
    stop();
    if (frame !== 0) cancelAnimationFrame(frame);
  };
}
