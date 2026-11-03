import { describe, expect, it } from 'vitest';
import {
  decodePeaks,
  encodePeaks,
  formatTime,
  peaksFromSamples,
  placeholderPeaks,
  PEAK_COUNT,
} from '@/media/waveform';

describe('a waveform', () => {
  it('is the loudest sample of each slice, the loudest slice at full height', () => {
    const quiet = new Float32Array(400).fill(0.1);
    const loud = new Float32Array(400).fill(-0.5);
    const samples = new Float32Array([...quiet, ...loud]);
    const peaks = peaksFromSamples([samples], 4);
    expect(peaks).toEqual([0.2, 0.2, 1, 1].map((value) => expect.closeTo(value, 5)));
  });

  it('takes the louder of two channels, and shows silence as a sliver', () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    right.fill(0.8, 50);
    const peaks = peaksFromSamples([left, right], 2);
    expect(peaks[0]).toBeGreaterThan(0);
    expect(peaks[0]).toBeLessThan(0.1);
    expect(peaks[1]).toBe(1);
  });

  it('keeps as one short string and comes back the same, to the nearest level', () => {
    const peaks = [0, 0.25, 0.5, 0.75, 1];
    const text = encodePeaks(peaks);
    expect(text).toHaveLength(5);
    decodePeaks(text)!.forEach((value, index) => expect(value).toBeCloseTo(peaks[index]!, 1));
    expect(decodePeaks('')).toBeNull();
    expect(decodePeaks('not!valid')).toBeNull();
  });

  it('is made up the same way every time for the same sound, when it cannot be read', () => {
    const one = placeholderPeaks('https://example.com/a.mp3');
    expect(one).toHaveLength(PEAK_COUNT);
    expect(placeholderPeaks('https://example.com/a.mp3')).toEqual(one);
    expect(placeholderPeaks('https://example.com/b.mp3')).not.toEqual(one);
    expect(Math.min(...one)).toBeGreaterThan(0);
    expect(Math.max(...one)).toBeLessThanOrEqual(1);
  });
});

describe('a player’s time', () => {
  it('reads as minutes and seconds, and hours when there are some', () => {
    expect(formatTime(7.9)).toBe('0:07');
    expect(formatTime(225)).toBe('3:45');
    expect(formatTime(3729)).toBe('1:02:09');
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
