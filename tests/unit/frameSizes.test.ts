import { describe, expect, it } from 'vitest';
import { FRAME_SIZES, hasRatio, resizedFrame } from '@/workshop/frameSizes';

describe('a frame sized to fill a screen', () => {
  it('takes the shape asked for and keeps about its area', () => {
    const frame = { w: 1600, h: 900 };
    const portrait = resizedFrame(frame, 9 / 19.5);
    expect(portrait.w / portrait.h).toBeCloseTo(9 / 19.5, 2);
    expect((portrait.w * portrait.h) / (1600 * 900)).toBeCloseTo(1, 2);
    expect(hasRatio(portrait, 9 / 19.5)).toBe(true);
    expect(hasRatio(portrait, 16 / 9)).toBe(false);
  });

  it('offers a phone either way round, a laptop and this screen', () => {
    expect(FRAME_SIZES.map((size) => size.id)).toEqual([
      'screen',
      'phone-landscape',
      'phone-portrait',
      'laptop',
      'laptop-tall',
    ]);
  });
});
