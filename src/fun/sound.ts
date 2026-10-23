import { useUiPrefs } from '@/state/uiPrefs';

/**
 * The celebrations' sounds, made on the spot with Web Audio — a drum roll is noise
 * struck faster and faster, a crowd clapping is many tiny noise bursts — so there are
 * no audio files to fetch, and nothing to license.
 */
let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (!useUiPrefs.getState().sound) return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

// A browser only lets a page make sound after the person has touched it; the first
// touch wakes the sound up, so celebrations someone else starts can be heard.
if (typeof window !== 'undefined') {
  const wake = () => {
    if (audio?.state === 'suspended') void audio.resume();
  };
  window.addEventListener('pointerdown', wake, { capture: true });
  window.addEventListener('keydown', wake, { capture: true });
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  return buffer;
}

/** A burst of filtered noise: a drum hit, a clap, a hiss. */
function hit(
  ctx: AudioContext,
  at: number,
  options: {
    length: number;
    volume: number;
    filter: BiquadFilterType;
    frequency: number;
    q?: number;
  },
) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, options.length);
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + options.length);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
  source.stop(at + options.length);
}

/** A pitched note: a pop, a bubble, a thud. */
function tone(
  ctx: AudioContext,
  at: number,
  options: { from: number; to: number; length: number; volume: number; type?: OscillatorType },
) {
  const oscillator = ctx.createOscillator();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(options.from, at);
  oscillator.frequency.exponentialRampToValueAtTime(options.to, at + options.length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + options.length);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + options.length);
}

function claps(ctx: AudioContext, start: number, seconds: number, density: number) {
  for (let index = 0; index < seconds * density; index += 1) {
    const at = start + Math.random() * seconds;
    const fade = 1 - (at - start) / seconds;
    hit(ctx, at, {
      length: 0.06,
      volume: 0.25 * (0.3 + 0.7 * fade),
      filter: 'bandpass',
      frequency: 1200 + Math.random() * 1400,
      q: 0.8,
    });
  }
}

export type SoundName =
  'confetti' | 'drumroll' | 'bubbles' | 'micdrop' | 'quiet' | 'curtain' | 'applause';

export function playSound(name: SoundName): void {
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime + 0.02;
  switch (name) {
    case 'confetti':
      // A party popper, then a sprinkle.
      hit(ctx, now, { length: 0.18, volume: 0.6, filter: 'bandpass', frequency: 900, q: 0.7 });
      for (let index = 0; index < 6; index += 1) {
        tone(ctx, now + 0.12 + index * 0.07, {
          from: 1400 + Math.random() * 1600,
          to: 2400 + Math.random() * 1200,
          length: 0.12,
          volume: 0.06,
        });
      }
      return;
    case 'drumroll': {
      // Snare strokes, ever faster and louder, then a cymbal and a kick.
      const length = 2.4;
      let at = now;
      while (at < now + length) {
        const progress = (at - now) / length;
        hit(ctx, at, {
          length: 0.07,
          volume: 0.12 + 0.3 * progress,
          filter: 'highpass',
          frequency: 1500,
        });
        at += 0.065 - 0.035 * progress;
      }
      hit(ctx, now + length, { length: 1.8, volume: 0.45, filter: 'highpass', frequency: 5000 });
      tone(ctx, now + length, { from: 120, to: 40, length: 0.5, volume: 0.7 });
      return;
    }
    case 'bubbles':
      for (let index = 0; index < 12; index += 1) {
        const pitch = 300 + Math.random() * 500;
        tone(ctx, now + index * 0.16 + Math.random() * 0.08, {
          from: pitch,
          to: pitch * 2.6,
          length: 0.09,
          volume: 0.12,
        });
      }
      return;
    case 'micdrop':
      // A whistle as it falls, then the thud and the feedback hum.
      tone(ctx, now, { from: 1800, to: 500, length: 0.6, volume: 0.05 });
      tone(ctx, now + 0.65, { from: 90, to: 35, length: 0.6, volume: 0.9 });
      hit(ctx, now + 0.65, { length: 0.25, volume: 0.5, filter: 'lowpass', frequency: 600 });
      tone(ctx, now + 0.7, { from: 2200, to: 2100, length: 0.9, volume: 0.03, type: 'square' });
      return;
    case 'quiet':
      hit(ctx, now, { length: 1.3, volume: 0.22, filter: 'highpass', frequency: 3500 });
      return;
    case 'curtain':
      claps(ctx, now + 0.4, 3, 70);
      return;
    case 'applause':
      claps(ctx, now, 2.6, 55);
      return;
  }
}
