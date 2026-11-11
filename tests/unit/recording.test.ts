import { describe, expect, it } from 'vitest';
import { cameraRect, tidyLayout, MAX_W, MIN_W } from '@/recording/camera';
import { soundAlone, videoAlone, videoWithSound } from '@/recording/formats';
import { encodeWav } from '@/recording/wav';

describe('the camera on the slide', () => {
  it('stays inside the slide, and within its size bounds', () => {
    const layout = tidyLayout({ x: 0.95, y: -0.2, w: 0.3, shape: 'circle' }, 9 / 16);
    expect(layout.x).toBeCloseTo(0.7);
    expect(layout.y).toBe(0);
    expect(tidyLayout({ w: 5 }).w).toBeLessThanOrEqual(MAX_W);
    expect(tidyLayout({ w: 0 }).w).toBe(MIN_W);
  });

  it('is never taller than the slide', () => {
    // A circle half the width of a wide slide would be taller than it.
    const layout = tidyLayout({ x: 0, y: 0, w: 0.8, shape: 'circle' }, 9 / 16);
    expect(layout.w).toBeCloseTo(9 / 16);
    const box = cameraRect(layout, { x: 0, y: 0, w: 1600, h: 900 });
    expect(box.h).toBeLessThanOrEqual(900.0001);
  });

  it('is placed in fractions of the slide, so any size of window shows it the same', () => {
    const layout = tidyLayout({ x: 0.5, y: 0.25, w: 0.2, shape: 'wide' });
    const small = cameraRect(layout, { x: 10, y: 20, w: 800, h: 450 });
    const big = cameraRect(layout, { x: 0, y: 0, w: 1600, h: 900 });
    expect(small).toEqual({ x: 410, y: 132.5, w: 160, h: 90 });
    expect(big.w / small.w).toBe(2);
    expect(big.h / big.w).toBeCloseTo(9 / 16);
  });

  it('falls back to the default shape for one it does not know', () => {
    expect(tidyLayout({ shape: 'star' as never }).shape).toBe('circle');
  });
});

describe('recording formats', () => {
  const only =
    (...types: string[]) =>
    (type: string) =>
      types.includes(type);

  it('makes MP4 with AAC, and M4A, where the browser can (Chrome on Windows and Mac)', () => {
    const supports = only(
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1.640028',
      'audio/mp4;codecs=mp4a.40.2',
    );
    expect(videoWithSound(supports)?.extension).toBe('mp4');
    expect(videoAlone(supports)?.extension).toBe('mp4');
    expect(soundAlone(supports)).toMatchObject({ extension: 'm4a', toWav: false });
  });

  it('still makes MP4 video without AAC, and the sound alone as WAV, never WebM', () => {
    const supports = only(
      'video/mp4;codecs=avc1,opus',
      'video/mp4;codecs=avc1',
      'audio/webm;codecs=opus',
    );
    expect(videoWithSound(supports)?.mimeType).toBe('video/mp4;codecs=avc1,opus');
    expect(videoAlone(supports)?.mimeType).toBe('video/mp4;codecs=avc1');
    expect(soundAlone(supports)).toMatchObject({ extension: 'wav', toWav: true });
  });

  it('says so when nothing can be made', () => {
    expect(videoWithSound(() => false)).toBeNull();
    expect(soundAlone(() => false)).toBeNull();
  });
});

describe('WAV', () => {
  it('writes a standard 16-bit PCM file', () => {
    const left = new Float32Array([0, 1, -1, 0.5]);
    const right = new Float32Array([0, -1, 1, -0.5]);
    const buffer = encodeWav({ sampleRate: 48000, channels: [left, right] });
    const view = new DataView(buffer);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(buffer.slice(at, at + 4)));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(buffer.byteLength).toBe(44 + 16);
    // Interleaved: left then right, each frame.
    expect(view.getInt16(44 + 4, true)).toBe(0x7fff);
    expect(view.getInt16(44 + 6, true)).toBe(-0x8000);
  });
});
