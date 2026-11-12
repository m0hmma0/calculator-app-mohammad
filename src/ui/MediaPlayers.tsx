import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { EmbedData } from '@/model/element';
import { useMediaSrc } from '@/media/mediaFiles';
import { useUploads } from '@/media/uploads';
import { formatTime, PEAK_COUNT, usePeaks } from '@/media/waveform';
import { useMutedHere } from '@/workshop/audience';
import { effectiveTool, useBoardStore } from '@/state/boardStore';
import styles from './MediaPlayers.module.css';

/**
 * Videos and sounds that play where they sit, from the moment they are on the board:
 * no double-click to wake them, nothing to close. Only their controls take the
 * pointer (marked `data-hud`, which the board leaves alone); a press anywhere else on
 * them selects and moves them like anything else. The controls answer to everyone —
 * someone who can only look, and a locked video or sound, still play — because
 * playing changes nothing on the board.
 *
 * They are laid out in board units and scaled with the board, so they stay the shape
 * of the card under them at any zoom.
 */

/** One plays at a time: starting one pauses whichever was playing. */
let current: HTMLMediaElement | null = null;
function playingNow(media: HTMLMediaElement) {
  if (current && current !== media) current.pause();
  current = media;
}

/** Keys on a control are the control's, not the board's shortcuts (Space, arrows). */
const keepKeys = (event: KeyboardEvent) => {
  if ([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.stopPropagation();
  }
};

/** A media element's time, smoothly while it plays; whether it plays; its length. */
function useClock(ref: RefObject<HTMLMediaElement | null>) {
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    let frame = 0;
    const tick = () => {
      setTime(media.currentTime);
      if (!media.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      playingNow(media);
      setPlaying(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      setTime(media.currentTime);
    };
    const onLength = () => setDuration(media.duration);
    const onTime = () => setTime(media.currentTime);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onPause);
    media.addEventListener('loadedmetadata', onLength);
    media.addEventListener('durationchange', onLength);
    media.addEventListener('seeked', onTime);
    if (media.readyState >= 1) onLength();
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onPause);
      media.removeEventListener('loadedmetadata', onLength);
      media.removeEventListener('durationchange', onLength);
      media.removeEventListener('seeked', onTime);
      if (current === media) current = null;
    };
  }, [ref]);

  return { time, duration, playing };
}

/**
 * Silent here while presenter view's audience window plays it (`useMutedHere`), so a
 * screen being shared or recorded does not carry it twice.
 */
function useMuted(ref: RefObject<HTMLMediaElement | null>, elementId: string) {
  const muted = useMutedHere(elementId);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  });
}

/** Plays from a fraction of the way through — once the length is known, if it is not yet. */
function playFrom(media: HTMLMediaElement, fraction: number) {
  const go = () => {
    if (Number.isFinite(media.duration)) media.currentTime = fraction * media.duration;
    void media.play().catch(() => {});
  };
  if (media.readyState >= 1) go();
  else media.addEventListener('loadedmetadata', go, { once: true });
}

function toggle(media: HTMLMediaElement | null) {
  if (!media) return;
  if (media.paused) void media.play().catch(() => {});
  else media.pause();
}

/**
 * Where along a strip the pointer is, from 0 to 1. The strip is scaled with the board,
 * so its own box on screen is what counts.
 */
function along(event: PointerEvent<HTMLElement>): number {
  const box = event.currentTarget.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
}

/** A strip that seeks: hovered, it says where a click would play from. */
function useSeeking(ref: RefObject<HTMLMediaElement | null>, duration: number) {
  const [hover, setHover] = useState<number | null>(null);
  return {
    hover,
    handlers: {
      onPointerMove: (event: PointerEvent<HTMLElement>) => setHover(along(event)),
      onPointerLeave: () => setHover(null),
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        const media = ref.current;
        if (media) playFrom(media, along(event));
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        keepKeys(event);
        const media = ref.current;
        if (!media || !Number.isFinite(duration)) return;
        const step = { ArrowLeft: -5, ArrowRight: 5 }[event.key];
        if (step) media.currentTime = Math.min(duration, Math.max(0, media.currentTime + step));
        if (event.key === 'Home') media.currentTime = 0;
        if (event.key === 'End') media.currentTime = duration;
      },
    },
  };
}

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Progress of the upload still under way, along the card's foot. */
function UploadBar({ fileId }: { fileId?: string }) {
  const upload = useUploads((state) => (fileId ? state.byId[fileId] : undefined));
  if (!upload) return null;
  const done = upload.total > 0 ? upload.loaded / upload.total : 0;
  return (
    <span className={styles.upload} data-rejected={upload.status === 'rejected' || undefined}>
      <span style={{ width: `${done * 100}%` }} />
    </span>
  );
}

/** Bars for a waveform: tall ones from a line two thirds down, faint reflections below. */
function barsPath(peaks: readonly number[], top: boolean): string {
  return peaks
    .map((peak, index) => {
      const x = index * 3;
      const height = top ? peak * 66 : peak * 30;
      const y = top ? 66 - height : 68;
      return `M${x} ${y.toFixed(1)}h2v${height.toFixed(1)}h-2Z`;
    })
    .join('');
}

/**
 * A sound, after SoundCloud's player: a round play button, the title, and the sound's
 * waveform — played part in colour, the rest grey. Hovering the waveform shows where
 * a click would play from; a click plays from there.
 */
export function SoundCard({
  elementId,
  embed,
  style,
  selected,
}: {
  elementId: string;
  embed: EmbedData;
  style: CSSProperties;
  selected: boolean;
}) {
  const src = useMediaSrc(embed);
  const ref = useRef<HTMLAudioElement>(null);
  const { time, duration, playing } = useClock(ref);
  useMuted(ref, elementId);
  const { peaks, real } = usePeaks(embed, src);
  const { hover, handlers } = useSeeking(ref, duration);
  const id = useId();
  const progress = Number.isFinite(duration) && duration > 0 ? time / duration : 0;
  const width = PEAK_COUNT * 3;

  return (
    <div
      className={styles.sound}
      style={style}
      data-testid="embed-media"
      data-media="audio"
      data-playing={playing || undefined}
      data-selected={selected || undefined}
    >
      {src ? (
        <audio
          ref={ref}
          src={src}
          preload="metadata"
          data-element-id={elementId}
          data-testid="embed-player"
        />
      ) : null}
      <button
        type="button"
        className={styles.round}
        data-media-controls
        aria-label={playing ? 'Pause' : 'Play'}
        data-hud
        data-wheel-pans
        data-testid="media-play"
        disabled={!src}
        onClick={() => toggle(ref.current)}
        onKeyDown={keepKeys}
      >
        <PlayIcon playing={playing} />
      </button>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.title}>{embed.title || 'Sound'}</span>
          <span className={styles.from}>{embed.site ?? 'Sound'}</span>
        </div>
        <div
          className={styles.wave}
          role="slider"
          tabIndex={0}
          aria-label="Play from"
          aria-valuemin={0}
          aria-valuemax={Number.isFinite(duration) ? Math.round(duration) : 0}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          data-hud
          data-wheel-pans
          data-testid="media-wave"
          data-real={real || undefined}
          {...handlers}
        >
          <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <clipPath id={`${id}played`}>
                <rect width={progress * width} height="100" />
              </clipPath>
              <clipPath id={`${id}hover`}>
                <rect width={(hover ?? 0) * width} height="100" />
              </clipPath>
            </defs>
            <g className={styles.rest}>
              <path d={barsPath(peaks, true)} />
              <path d={barsPath(peaks, false)} opacity="0.45" />
            </g>
            {hover !== null ? (
              <g className={styles.ahead} clipPath={`url(#${id}hover)`}>
                <path d={barsPath(peaks, true)} />
                <path d={barsPath(peaks, false)} opacity="0.45" />
              </g>
            ) : null}
            <g className={styles.played} clipPath={`url(#${id}played)`}>
              <path d={barsPath(peaks, true)} />
              <path d={barsPath(peaks, false)} opacity="0.45" />
            </g>
          </svg>
          {hover !== null ? (
            <span className={styles.cursor} style={{ left: `${hover * 100}%` }}>
              <span data-testid="media-hover-time">
                {formatTime(hover * (Number.isFinite(duration) ? duration : 0))}
              </span>
            </span>
          ) : null}
          <span className={styles.time} data-testid="media-time">
            {formatTime(time)}
          </span>
          <span className={`${styles.time} ${styles.length}`}>{formatTime(duration)}</span>
        </div>
      </div>
      <UploadBar fileId={embed.fileId} />
    </div>
  );
}

/**
 * A video file: its first picture until it plays, a big play button over it while it
 * is paused, and a bar along the bottom to play, pause, seek and fill the screen —
 * there while it is paused, and on hover while it plays.
 */
export function VideoCard({
  elementId,
  embed,
  style,
  selected,
}: {
  elementId: string;
  embed: EmbedData;
  style: CSSProperties;
  selected: boolean;
}) {
  const src = useMediaSrc(embed);
  const ref = useRef<HTMLVideoElement>(null);
  const { time, duration, playing } = useClock(ref);
  useMuted(ref, elementId);
  const tapToPause = useBoardStore((state) => {
    const tool = effectiveTool(state);
    return tool === 'select' || tool === 'hand';
  });
  const { hover, handlers } = useSeeking(ref, duration);
  const progress = Number.isFinite(duration) && duration > 0 ? time / duration : 0;

  // Full screen has nothing of the board around it, so the browser's own controls.
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const onChange = () => {
      media.controls = document.fullscreenElement === media;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <div
      className={styles.video}
      style={style}
      data-testid="embed-media"
      data-media="video"
      data-playing={playing || undefined}
      data-selected={selected || undefined}
    >
      {src ? (
        <video
          ref={ref}
          className={styles.screen}
          src={src}
          preload="metadata"
          playsInline
          data-element-id={elementId}
          data-testid="embed-player"
        />
      ) : null}
      {/* Playing, a click on the picture pauses it — with a tool that does not draw. */}
      {playing && tapToPause ? (
        <button
          type="button"
          className={styles.tap}
          aria-label="Pause"
          data-hud
          data-wheel-pans
          data-media-controls
          data-testid="media-tap"
          onClick={() => toggle(ref.current)}
          onKeyDown={keepKeys}
        />
      ) : null}
      {!playing ? (
        <button
          type="button"
          className={styles.bigPlay}
          data-media-controls
          aria-label="Play"
          data-hud
          data-wheel-pans
          data-testid="media-play"
          disabled={!src}
          onClick={() => toggle(ref.current)}
          onKeyDown={keepKeys}
        >
          <PlayIcon playing={false} />
        </button>
      ) : null}
      <div className={styles.bar} data-hud data-wheel-pans data-media-controls>
        <button
          type="button"
          className={styles.barButton}
          aria-label={playing ? 'Pause' : 'Play'}
          data-testid="media-toggle"
          disabled={!src}
          onClick={() => toggle(ref.current)}
          onKeyDown={keepKeys}
        >
          <PlayIcon playing={playing} />
        </button>
        <span className={styles.clock} data-testid="media-time">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <div
          className={styles.seek}
          role="slider"
          tabIndex={0}
          aria-label="Play from"
          aria-valuemin={0}
          aria-valuemax={Number.isFinite(duration) ? Math.round(duration) : 0}
          aria-valuenow={Math.round(time)}
          data-testid="media-seek"
          {...handlers}
        >
          <span className={styles.track} />
          {hover !== null ? (
            <span className={styles.trackHover} style={{ width: `${hover * 100}%` }} />
          ) : null}
          <span className={styles.trackPlayed} style={{ width: `${progress * 100}%` }} />
          {hover !== null ? (
            <span className={styles.seekTime} style={{ left: `${hover * 100}%` }}>
              {formatTime(hover * (Number.isFinite(duration) ? duration : 0))}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.barButton}
          aria-label="Full screen"
          data-testid="media-fullscreen"
          disabled={!src}
          onClick={() => void ref.current?.requestFullscreen?.().catch(() => {})}
          onKeyDown={keepKeys}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <UploadBar fileId={embed.fileId} />
    </div>
  );
}
