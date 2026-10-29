import { embedImageHeight } from '@/canvas/renderContent';
import { boardToScreen } from '@/canvas/viewport';
import { useHistory } from '@/collab/history';
import { useBoardStore } from '@/state/boardStore';
import { useEmbeds } from '@/state/embedStore';
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

  const embeds = (preview ?? elements).filter(
    (element) => element.type === 'embed' && element.embed && !element.hidden,
  );
  if (embeds.length === 0) return null;

  return (
    <div className={styles.layer} data-present-keep aria-hidden={playing ? undefined : true}>
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
                  {/* The player takes every click, so the board gets this strip: press it
                      to select the video (and delete it), drag it to move the video. */}
                  <div
                    className={styles.grip}
                    title="Drag to move · click to select"
                    data-testid="embed-grip"
                  >
                    ⠿
                  </div>
                  <iframe
                    className={styles.frame}
                    src={`https://www.youtube-nocookie.com/embed/${embed.videoId}?autoplay=1&rel=0`}
                    title={embed.title ?? 'Video'}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    data-testid="embed-player"
                  />
                  <button
                    type="button"
                    className={styles.stop}
                    aria-label="Stop the video"
                    onClick={() => useEmbeds.setState({ playing: null })}
                  >
                    ×
                  </button>
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
