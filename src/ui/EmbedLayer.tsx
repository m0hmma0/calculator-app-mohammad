import type { CSSProperties } from 'react';
import { embedImageHeight } from '@/canvas/renderContent';
import { boardToScreen } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { useBoardStore } from '@/state/boardStore';
import { startPlayer, useEmbeds } from '@/state/embedStore';
import { SoundCard, VideoCard } from './MediaPlayers';
import { useFrameOnShow } from '@/workshop/onShow';
import { usePresentation } from '@/workshop/presentation';
import styles from './EmbedLayer.module.css';

/**
 * What a canvas cannot hold: videos and sounds that play, and pictures from other
 * sites. Each sits over its card, following it as the board pans, zooms and rotates.
 * Only the players' own controls take the pointer; everything else here lets it
 * through to the board, so an embed is selected and moved like anything else.
 */
export function EmbedLayer() {
  const elements = useBoardStore((state) => state.elements);
  const viewport = useBoardStore((state) => state.viewport);
  const selection = useBoardStore((state) => state.selection);
  const preview = useHistory((state) => state.preview);
  const started = useEmbeds((state) => state.started);
  const onShow = useFrameOnShow();
  // Presenter view: other sites' players play in the audience window, not here too.
  const playsElsewhere = usePresentation((state) => state.audience);

  const embeds = (preview ?? elements).filter(
    (element) => element.type === 'embed' && element.embed && !element.hidden,
  );
  if (embeds.length === 0) return null;

  // A frame on show is all that shows: an embed beyond its edge is cut off there.
  let clipPath: string | undefined;
  if (onShow) {
    const from = boardToScreen(viewport, { x: onShow.x, y: onShow.y });
    const to = boardToScreen(viewport, { x: onShow.x + onShow.w, y: onShow.y + onShow.h });
    clipPath = `polygon(${from.x}px ${from.y}px, ${to.x}px ${from.y}px, ${to.x}px ${to.y}px, ${from.x}px ${to.y}px)`;
  }

  return (
    <div className={styles.layer} style={{ clipPath }}>
      {embeds.map((element) => {
        const embed = element.embed!;
        const topLeft = boardToScreen(viewport, { x: element.x, y: element.y });
        const width = element.w * viewport.zoom;
        const height = element.h * viewport.zoom;
        const box = {
          left: topLeft.x,
          top: topLeft.y,
          width,
          height,
          transform: element.rotation ? `rotate(${element.rotation}rad)` : undefined,
          opacity: element.opacity,
          borderRadius: element.style.radius * viewport.zoom,
        };
        // Laid out in board units, then scaled (and turned about its middle) with the board.
        const half = { x: element.w / 2, y: element.h / 2 };
        const scaled: CSSProperties = {
          left: topLeft.x,
          top: topLeft.y,
          width: element.w,
          height: element.h,
          opacity: element.opacity,
          transform:
            `scale(${viewport.zoom})` +
            (element.rotation
              ? ` translate(${half.x}px, ${half.y}px) rotate(${element.rotation}rad) translate(${-half.x}px, ${-half.y}px)`
              : ''),
        };
        const selected = selection.includes(element.id);
        const isStarted = started.includes(element.id);

        if (embed.kind === 'video' && embed.videoId) {
          return (
            <div key={element.id} className={styles.embed} style={box} data-testid="embed-video">
              {isStarted && playsElsewhere ? (
                <Elsewhere />
              ) : isStarted ? (
                <>
                  <Grip />
                  <iframe
                    className={styles.frame}
                    src={`https://www.youtube-nocookie.com/embed/${embed.videoId}?autoplay=1&rel=0`}
                    title={embed.title ?? 'Video'}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    data-testid="embed-player"
                  />
                </>
              ) : (
                <>
                  <img
                    className={styles.cover}
                    src={`https://i.ytimg.com/vi/${embed.videoId}/hqdefault.jpg`}
                    alt=""
                    draggable={false}
                    loading="lazy"
                  />
                  <PlayButton
                    className={styles.play}
                    label={`Play ${embed.title ?? 'the video'}`}
                    onPlay={() => startPlayer(element.id)}
                  />
                </>
              )}
            </div>
          );
        }

        if (embed.kind === 'media') {
          return embed.media === 'video' ? (
            <VideoCard
              key={element.id}
              elementId={element.id}
              embed={embed}
              style={scaled}
              selected={selected}
            />
          ) : (
            <SoundCard
              key={element.id}
              elementId={element.id}
              embed={embed}
              style={scaled}
              selected={selected}
            />
          );
        }

        if (embed.kind === 'player' && embed.player) {
          if (isStarted && playsElsewhere) {
            return (
              <div key={element.id} className={styles.embed} style={box}>
                <Elsewhere />
              </div>
            );
          }
          if (isStarted) {
            return (
              <div
                key={element.id}
                className={styles.embed}
                style={box}
                data-testid="embed-site-player"
              >
                <Grip />
                <iframe
                  className={styles.frame}
                  src={autoplaying(embed.player)}
                  title={embed.title ?? embed.site ?? 'Player'}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                  allowFullScreen
                  data-testid="embed-player"
                />
              </div>
            );
          }
          // Over the round button the board draws on the card (renderContent's
          // drawPlayable), in the same place.
          const r = Math.min(element.h * 0.28, 30);
          const top = Math.min(element.h / 2, 16 + r) - r;
          return (
            <div key={element.id} className={styles.sitePlayer} style={scaled}>
              <PlayButton
                className={styles.siteButton}
                style={{ left: 16, top, width: r * 2, height: r * 2 }}
                label={`Play on ${embed.site ?? 'the site'}`}
                onPlay={() => startPlayer(element.id)}
              />
            </div>
          );
        }

        if (embed.kind === 'link' && embed.image) {
          const imageHeight = embedImageHeight(element) * viewport.zoom;
          return (
            <div
              key={element.id}
              className={styles.embed}
              style={{
                ...box,
                height: imageHeight,
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
              }}
              data-testid="embed-card-image"
              aria-hidden="true"
            >
              <img
                className={styles.cover}
                src={embed.image}
                alt=""
                draggable={false}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

/** Another site's player, asked to start playing as soon as it has loaded. */
function autoplaying(address: string): string {
  try {
    const url = new URL(address);
    url.searchParams.set('autoplay', url.hostname.includes('soundcloud') ? 'true' : '1');
    return url.href;
  } catch {
    return address;
  }
}

/** One click and it plays: the board leaves this button alone, whoever is looking. */
function PlayButton({
  className,
  style,
  label,
  onPlay,
}: {
  className?: string;
  style?: CSSProperties;
  label: string;
  onPlay: () => void;
}) {
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      title={label}
      data-hud
      data-wheel-pans
      data-testid="media-play"
      data-media-controls
      onClick={onPlay}
    >
      <span aria-hidden="true">▶</span>
    </button>
  );
}

/** In presenter view, where another site's player is playing instead. */
function Elsewhere() {
  return (
    <p className={styles.elsewhere} data-testid="embed-elsewhere">
      Playing in the audience window
    </p>
  );
}

/**
 * The player takes every click, so the board gets this strip above it: press it to
 * select the video (and delete it), drag it to move the video.
 */
function Grip() {
  return (
    <div
      className={styles.grip}
      title="Drag to move · click to select"
      data-testid="embed-grip"
      data-media-controls
    >
      ⠿
    </div>
  );
}
