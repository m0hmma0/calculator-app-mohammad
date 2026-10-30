import { describe, expect, it } from 'vitest';
import { variantAfter } from '@/fun/effects';
import { seeded } from '@/fun/random';

describe('a celebration played again', () => {
  it('is never the same variation as the one before', () => {
    for (const count of [3, 4, 12]) {
      for (let last = 0; last < count; last += 1) {
        for (const random of [0, 0.2, 0.5, 0.77, 0.999, 1]) {
          const next = variantAfter(last, count, random);
          expect(next).not.toBe(last);
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThan(count);
        }
      }
    }
  });

  it('can be any variation the first time', () => {
    expect(new Set([0, 0.3, 0.6, 0.9].map((random) => variantAfter(undefined, 4, random)))).toEqual(
      new Set([0, 1, 2, 3]),
    );
  });

  it('draws the same pieces on every screen: its id seeds the randomness', () => {
    const a = seeded('confetti-abc');
    const b = seeded('confetti-abc');
    const c = seeded('confetti-abd');
    const run = (next: () => number) => Array.from({ length: 5 }, next);
    expect(run(a)).toEqual(run(b));
    expect(run(seeded('confetti-abc'))).not.toEqual(run(c));
  });
});
