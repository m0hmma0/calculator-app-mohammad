import type { CSSProperties } from 'react';
import { embedImageHeight } from '@/canvas/renderContent';
import { boardToScreen } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { useBoardStore } from '@/state/boardStore';
import { useMediaSrc } from '@/media/mediaFiles';
import type { EmbedData } from '@/model/element';
import { useEmbeds } from '@/state/embedStore';
import { useFrameOnShow } from '@/workshop/onShow';
import styles from './EmbedLayer.module.css';

/**
 * What a canvas cannot hold: a video that plays, and pictures from other sites. Each
 * sits over its card, following it as the board pans, zooms and rotates. Until a
 * video is played the layer lets every click through, so an embed is moved and
 * selected like anything else.
 */
export function EmbedLayer() {
  const elements = useBoardStore((state) => state.elements);
  const viewport = useBoardStore((state) => state.viewport);
  const preview = useHistory((state) => state.preview);
  const playing = useEmbeds((state) => state.playing);
  const onShow = useFrameOnShow();

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
    <div className={styles.layer} style={{ clipPath }} aria-hidden={playing ? undefined : true}>
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

        if (embed.kind === 'video' && embed.videoId) {
          const isPlaying = playing === element.id;
          return (
            <div key={element.id} className={styles.embed} style={box} data-testid="embed-video">
              {isPlaying ? (
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
                  <StopButton label="Stop the video" />
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
                  <span className={styles.play} aria-hidden="true">
                    ▶
                  </span>
                  <span className={styles.hint}>Double-click to play</span>
                </>
              )}
            </div>
          );
        }

        if (embed.kind === 'media') {
          return (
            <MediaEmbed key={element.id} embed={embed} box={box} playing={playing === element.id} />
          );
        }

        if (embed.kind === 'player' && embed.player && playing === element.id) {
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
                src={embed.player}
                title={embed.title ?? embed.site ?? 'Player'}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                allowFullScreen
                data-testid="embed-player"
              />
              <StopButton label="Stop playing" />
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

/**
 * The player takes every click, so the board gets this strip above it: press it to
 * select the video (and delete it), drag it to move the video.
 */
function Grip() {
  return (
    <div className={styles.grip} title="Drag to move · click to select" data-testid="embed-grip">
      ⠿
    </div>
  );
}

function StopButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={styles.stop}
      aria-label={label}
      data-testid="embed-stop"
      onClick={() => useEmbeds.setState({ playing: null })}
    >
      ×
    </button>
  );
}

/**
 * A video or a sound file — uploaded, or linked from elsewhere — played by the
 * browser itself. A video shows its first picture until it is played; a sound is the
 * card the board draws, with the player in it once it plays.
 */
function MediaEmbed({
  embed,
  box,
  playing,
}: {
  embed: EmbedData;
  box: CSSProperties;
  playing: boolean;
}) {
  const src = useMediaSrc(embed);
  const video = embed.media === 'video';

  // A sound not playing is the card the board draws; this only marks where it is.
  if (!video && !playing) {
    return (
      <div
        className={styles.marker}
        style={box}
        data-testid="embed-media"
        data-media="audio"
        aria-hidden="true"
      />
    );
  }
  return (
    <div
      className={styles.embed}
      style={box}
      data-kind={video ? 'video' : 'audio'}
      data-testid="embed-media"
      data-media={embed.media}
    >
      {playing ? (
        <>
          <Grip />
          {src ? (
            video ? (
              <video
                className={styles.frame}
                src={src}
                controls
                autoPlay
                playsInline
                data-testid="embed-player"
              />
            ) : (
              <audio
                className={styles.audio}
                src={src}
                controls
                autoPlay
                data-testid="embed-player"
              />
            )
          ) : null}
          <StopButton label={video ? 'Stop the video' : 'Stop the sound'} />
        </>
      ) : src ? (
        <>
          <video className={styles.cover} src={src} preload="metadata" muted playsInline />
          <span className={styles.play} aria-hidden="true">
            ▶
          </span>
          <span className={styles.hint}>Double-click to play</span>
        </>
      ) : null}
    </div>
  );
}
