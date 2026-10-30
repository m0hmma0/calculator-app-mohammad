import type { Point } from '@/geometry';
import { api } from '@/api/client';
import type { EmbedData } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import { embedSize } from './mediaFiles';

/** A single web address, and nothing else — what pasting a link looks like. */
export function asUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/** YouTube's id for a video, from any of the address forms people paste. */
export function youTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const id =
    host === 'youtu.be'
      ? url.pathname.slice(1).split('/')[0]
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? (url.searchParams.get('v') ??
          /^\/(?:embed|shorts|live|v)\/([\w-]+)/.exec(url.pathname)?.[1] ??
          null)
        : null;
  return id && /^[\w-]{6,20}$/.test(id) ? id : null;
}

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|mov)$/i;
const AUDIO_FILE = /\.(mp3|m4a|aac|wav|oga|ogg|opus|flac)$/i;

/** A link straight to a video or sound file, told by its name. */
export function mediaLink(url: URL): 'video' | 'audio' | null {
  if (VIDEO_FILE.test(url.pathname)) return 'video';
  if (AUDIO_FILE.test(url.pathname)) return 'audio';
  return null;
}

const fileName = (url: URL) =>
  decodeURIComponent(url.pathname.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || url.hostname;

/**
 * Sites whose own players can sit on a board: Vimeo's videos, SoundCloud's and
 * Spotify's sounds. The player is the site's embed address for the page pasted.
 */
export function sitePlayer(url: URL): Pick<EmbedData, 'player' | 'site' | 'media'> | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'vimeo.com') {
    const id = /^\/(\d{4,12})(?:\/|$)/.exec(url.pathname)?.[1];
    if (id)
      return { player: `https://player.vimeo.com/video/${id}`, site: 'Vimeo', media: 'video' };
  }
  if (host === 'soundcloud.com' && /^\/[\w-]+\/[\w-]+/.test(url.pathname)) {
    const page = `https://soundcloud.com${url.pathname}`;
    return {
      player: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}`,
      site: 'SoundCloud',
      media: 'audio',
    };
  }
  if (host === 'open.spotify.com') {
    const found = /^\/(?:intl-[\w-]+\/)?(track|episode|album|playlist|show)\/(\w{8,40})/.exec(
      url.pathname,
    );
    if (found) {
      return {
        player: `https://open.spotify.com/embed/${found[1]}/${found[2]}`,
        site: 'Spotify',
        media: 'audio',
      };
    }
  }
  return null;
}

/**
 * Puts a pasted link on the board where it was pasted: a video or a sound that plays
 * in place — YouTube, a file, another site's player — or a card that fills in with the
 * page's title, summary and picture once the server has fetched them. A link to a
 * file that does not say what it is in its name becomes a player when the server
 * finds it is one.
 */
export function placeLink(url: URL, at: Point): void {
  const store = useBoardStore.getState();
  const videoId = youTubeId(url);
  const media = mediaLink(url);
  const player = videoId ? null : sitePlayer(url);
  const embed: EmbedData = videoId
    ? { kind: 'video', url: url.href, videoId, site: 'YouTube' }
    : media
      ? { kind: 'media', media, url: url.href, title: fileName(url), site: url.hostname }
      : player
        ? { kind: 'player', url: url.href, title: player.site, ...player }
        : { kind: 'link', url: url.href, title: url.hostname, site: url.hostname };
  const size =
    embed.kind === 'link'
      ? { w: 360, h: 120 }
      : embedSize(embed.kind === 'video' ? { ...embed, media: 'video' } : embed);

  const element = store.insertAt('embed', size, { embed });
  if (!element) return;
  // insertAt centres it in view; a paste belongs under the pointer.
  const move = (id: string, box: { w: number; h: number }) =>
    useBoardStore
      .getState()
      .applyDiscrete(new Map([[id, { x: at.x - box.w / 2, y: at.y - box.h / 2 }]]));
  move(element.id, size);
  if (embed.kind !== 'link') return;

  void api
    .unfurl(url.href)
    .then((preview) => {
      const current = useBoardStore
        .getState()
        .elements.find((candidate) => candidate.id === element.id);
      if (!current?.embed) return;
      if (preview.media) {
        // It was a file all along: a player, not a card.
        const playable: EmbedData = {
          kind: 'media',
          media: preview.media,
          url: url.href,
          title: preview.title ?? fileName(url),
          site: preview.site ?? url.hostname,
        };
        const box = embedSize(playable);
        useBoardStore
          .getState()
          .applyDiscrete(new Map([[element.id, { embed: playable, ...box }]]));
        move(element.id, box);
        return;
      }
      // A picture makes the card taller, so the text keeps its room below it.
      const patch = {
        embed: { ...current.embed, ...preview },
        h: preview.image ? Math.max(current.h, 300) : current.h,
      };
      useBoardStore.getState().applyDiscrete(new Map([[element.id, patch]]));
    })
    .catch(() => {
      // No preview: the card still links to the page, titled by its address.
    });
}
