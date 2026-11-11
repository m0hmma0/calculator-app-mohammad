import { describe, expect, it } from 'vitest';
import { cameraRect, tidyLayout, MAX_W, MIN_W } from '@/recording/camera';
import { chooseCodecs, RESOLUTIONS } from '@/recording/formats';

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
  const size = { width: 1920, height: 1080, bitrate: 8_000_000 };
  const videos =
    (...codecs: string[]) =>
    async (config: VideoEncoderConfig) =>
      codecs.includes(config.codec);

  it('uses High-profile H.264 and AAC where the browser has both (Chrome on Windows and Mac)', async () => {
    const codecs = await chooseCodecs(size, {
      video: videos('avc1.640028', 'avc1.42e028'),
      audio: async (config) => config.codec === 'mp4a.40.2',
    });
    expect(codecs).toEqual({ video: 'avc1.640028', aac: true });
  });

  it('falls back to a simpler H.264 profile, and to Opus without an AAC encoder', async () => {
    const codecs = await chooseCodecs(size, {
      video: videos('avc1.42e028'),
      audio: async () => false,
    });
    expect(codecs).toEqual({ video: 'avc1.42e028', aac: false });
  });

  it('picks a level that allows the size: 720p asks for 3.1, 1080p for 4.0', async () => {
    const asked: string[] = [];
    await chooseCodecs(RESOLUTIONS[720], {
      video: async (config) => {
        asked.push(config.codec);
        return true;
      },
      audio: async () => true,
    });
    expect(asked).toEqual(['avc1.64001f']);
  });

  it('says so when there is no H.264 at all', async () => {
    expect(
      await chooseCodecs(size, { video: async () => false, audio: async () => true }),
    ).toBeNull();
  });
});
