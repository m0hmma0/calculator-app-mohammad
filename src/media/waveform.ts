import { useEffect, useState } from 'react';
import type { EmbedData } from '@/model/element';

/**
 * A sound's shape, for the player's waveform: its loudness in PEAK_COUNT slices, each
 * from 0 to 1. Worked out once, from the file, when a sound is put on the board, and
 * kept on the board with it (`embed.peaks`) as one short string, so nobody else has to
 * fetch and decode the file to draw it. A sound added by a link, or before this,
 * has its shape worked out where it is shown, when the file can be read; one that
 * cannot (another site that does not allow it) shows an even, made-up shape that
 * still plays and seeks.
 */
export const PEAK_COUNT = 160;

/** 62 levels, one character each. */
const LEVELS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Silence still shows as a sliver, so the waveform reads as one. */
const FLOOR = 0.04;
/** Decoded at a low rate: plenty for a picture of loudness, and a fraction of the memory. */
const DECODE_RATE = 8000;

export function encodePeaks(peaks: readonly number[]): string {
  return peaks
    .map((peak) => LEVELS[Math.round(Math.min(1, Math.max(0, peak)) * (LEVELS.length - 1))])
    .join('');
}

export function decodePeaks(text: string | undefined): number[] | null {
  if (!text) return null;
  const peaks: number[] = [];
  for (const character of text) {
    const level = LEVELS.indexOf(character);
    if (level === -1) return null;
    peaks.push(level / (LEVELS.length - 1));
  }
  return peaks.length > 0 ? peaks : null;
}

/** The loudest sample in each slice, scaled so the loudest slice fills the height. */
export function peaksFromSamples(channels: readonly Float32Array[], count = PEAK_COUNT): number[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0) return [];
  const peaks: number[] = [];
  for (let slice = 0; slice < count; slice += 1) {
    const start = Math.floor((slice * length) / count);
    const end = Math.max(start + 1, Math.floor(((slice + 1) * length) / count));
    let loudest = 0;
    for (const channel of channels) {
      for (let index = start; index < end && index < length; index += 1) {
        const value = Math.abs(channel[index]!);
        if (value > loudest) loudest = value;
      }
    }
    peaks.push(loudest);
  }
  const top = Math.max(...peaks);
  return peaks.map((peak) => Math.max(FLOOR, top > 0 ? peak / top : 0));
}

/** A file's waveform, or null if the browser cannot decode it. */
export async function peaksOf(
  data: Blob | ArrayBuffer,
  count = PEAK_COUNT,
): Promise<number[] | null> {
  try {
    const bytes = data instanceof Blob ? await data.arrayBuffer() : data.slice(0);
    const context = new OfflineAudioContext(1, 1, DECODE_RATE);
    const audio = await context.decodeAudioData(bytes);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
      audio.getChannelData(index),
    );
    const peaks = peaksFromSamples(channels, count);
    return peaks.length > 0 ? peaks : null;
  } catch {
    return null;
  }
}

/**
 * The made-up shape for a sound that cannot be read: gentle hills, always the same for
 * the same address, so it does not change from one look to the next.
 */
export function placeholderPeaks(seed: string, count = PEAK_COUNT): number[] {
  let hash = 2166136261;
  for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const random = () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => {
    const swell = 0.55 + 0.25 * Math.sin((index / count) * Math.PI * 3 + random());
    return Math.max(FLOOR, Math.min(1, swell * (0.6 + 0.4 * random())));
  });
}

/** Shapes worked out in this tab, by the address played. */
const worked = new Map<string, Promise<number[] | null>>();

/**
 * The waveform to draw for a sound: the one kept with it; else one worked out from
 * the file here (once per address); else the made-up one, marked as such.
 */
export function usePeaks(embed: EmbedData, src: string | null): { peaks: number[]; real: boolean } {
  const kept = decodePeaks(embed.peaks);
  const [found, setFound] = useState<number[] | null>(null);

  useEffect(() => {
    if (kept || !src) return;
    let live = true;
    let pending = worked.get(src);
    if (!pending) {
      pending = fetch(src)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .then((bytes) => (bytes ? peaksOf(bytes) : null))
        .catch(() => null);
      worked.set(src, pending);
    }
    void pending.then((peaks) => {
      if (live && peaks) setFound(peaks);
    });
    return () => {
      live = false;
    };
    // `kept` stands for embed.peaks, which is in the list as itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed.peaks, src]);

  if (kept) return { peaks: kept, real: true };
  if (found) return { peaks: found, real: true };
  return { peaks: placeholderPeaks(embed.url), real: false };
}

/** A time as a player shows it: 0:07, 3:45, 1:02:09. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
}
