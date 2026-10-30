import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { fileIdsInDoc, maxBytesFor, mediaKindOf } from '@shared/files';
import { mediaLink, sitePlayer } from '@/media/embeds';
import { embedSize, mediaTypeOf } from '@/media/mediaFiles';

describe('video and sound files', () => {
  it('are told apart by their type, or failing that their name', () => {
    expect(mediaKindOf('video/webm')).toBe('video');
    expect(mediaKindOf('audio/mpeg')).toBe('audio');
    expect(mediaKindOf('image/png')).toBeNull();
    expect(mediaTypeOf({ type: '', name: 'Lesson 3.M4A' })).toBe('audio/mp4');
    expect(mediaTypeOf({ type: 'video/mp4', name: 'clip' })).toBe('video/mp4');
    expect(mediaTypeOf({ type: 'text/plain', name: 'notes.txt' })).toBeNull();
  });

  it('may be bigger than a picture, a video most of all', () => {
    expect(maxBytesFor('video/mp4')).toBeGreaterThan(maxBytesFor('audio/mpeg'));
    expect(maxBytesFor('audio/mpeg')).toBeGreaterThan(maxBytesFor('image/png'));
  });

  it('keep their stored copy, as a picture does: the board names them by hash', () => {
    const doc = new Y.Doc();
    const element = new Y.Map<unknown>();
    const hash = 'a'.repeat(64);
    element.set('embed', {
      kind: 'media',
      media: 'video',
      url: `/api/files/${hash}`,
      fileId: hash,
    });
    doc.getMap('elements').set('one', element);
    expect(fileIdsInDoc(doc)).toEqual([hash]);
  });

  it('start as wide as a video player, in their own shape; a sound is a short card', () => {
    expect(embedSize({ kind: 'media', media: 'video', url: '' }, 4 / 3)).toEqual({
      w: 480,
      h: 360,
    });
    expect(embedSize({ kind: 'media', media: 'audio', url: '' }).h).toBeLessThan(150);
  });
});

describe('links people paste', () => {
  it('to a file play as one, told by the name', () => {
    expect(mediaLink(new URL('https://example.com/talk.mp4?x=1'))).toBe('video');
    expect(mediaLink(new URL('https://example.com/a/b/song.MP3'))).toBe('audio');
    expect(mediaLink(new URL('https://example.com/page'))).toBeNull();
  });

  it('to Vimeo, SoundCloud or Spotify open that site’s own player', () => {
    expect(sitePlayer(new URL('https://vimeo.com/76979871'))).toMatchObject({
      player: 'https://player.vimeo.com/video/76979871',
      media: 'video',
    });
    expect(sitePlayer(new URL('https://soundcloud.com/artist/a-track'))?.player).toBe(
      `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://soundcloud.com/artist/a-track')}`,
    );
    expect(
      sitePlayer(new URL('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC')),
    ).toMatchObject({
      player: 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
      media: 'audio',
    });
    expect(sitePlayer(new URL('https://vimeo.com/about'))).toBeNull();
  });
});
