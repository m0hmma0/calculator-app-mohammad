import { describe, expect, it } from 'vitest';
import { pictureBox, PICTURE_FIT_ZOOM } from '@/media/images';

const STAGE = 580; // a screen this tall is 1000 board units tall at 58% zoom
const screen = STAGE / PICTURE_FIT_ZOOM;
const sized = (w: number, h: number) => pictureBox({ naturalWidth: w, naturalHeight: h }, STAGE);

describe('the size a picture lands at', () => {
  it('is half the screen height at 58% zoom when near square, or tall', () => {
    expect(sized(800, 800)).toEqual({ w: 500, h: 500 });
    expect(sized(4000, 3000).h).toBe(Math.round(screen / 2)); // a phone photo
    expect(sized(1500, 1000).h).toBe(Math.round(screen / 2)); // 3:2, still near square
    expect(sized(900, 1600).h).toBe(Math.round(screen / 2)); // a phone screenshot, upright
  });

  it('is a sixth of it when clearly wide, and a ninth when very wide', () => {
    expect(sized(1920, 1080).h).toBe(Math.round(screen / 6)); // a screenshot
    expect(sized(2000, 700).h).toBe(Math.round(screen / 6)); // under three times as wide
    expect(sized(1000, 200).h).toBe(Math.round(screen / 9)); // a banner
  });

  it('keeps the picture’s shape, whatever the size', () => {
    const { w, h } = sized(1920, 1080);
    expect(w / h).toBeCloseTo(1920 / 1080, 1);
  });
});
