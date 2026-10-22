import type { Point } from '@/geometry';
import { api } from '@/api/client';
import type { EmbedData } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';

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

/**
 * Puts a pasted link on the board where it was pasted: a video that plays in place,
 * or a card that fills in with the page's title, summary and picture once the server
 * has fetched them.
 */
export function placeLink(url: URL, at: Point): void {
  const store = useBoardStore.getState();
  const videoId = youTubeId(url);
  const embed: EmbedData = videoId
    ? { kind: 'video', url: url.href, videoId, site: 'YouTube' }
    : { kind: 'link', url: url.href, title: url.hostname, site: url.hostname };
  const size = videoId ? { w: 480, h: 270 } : { w: 360, h: 120 };

  const element = store.insertAt('embed', size, { embed });
  if (!element) return;
  // insertAt centres it in view; a paste belongs under the pointer.
  store.applyDiscrete(new Map([[element.id, { x: at.x - size.w / 2, y: at.y - size.h / 2 }]]));
  if (videoId) return;

  void api
    .unfurl(url.href)
    .then((preview) => {
      const current = useBoardStore
        .getState()
        .elements.find((candidate) => candidate.id === element.id);
      if (!current?.embed) return;
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
