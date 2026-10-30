import { useUiPrefs } from '@/state/uiPrefs';
import { seeded } from './random';

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

function noiseBuffer(ctx: AudioContext, seconds: number, random: () => number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = random() * 2 - 1;
  return buffer;
}

/** Where one play's sounds go: its own volume, so a pile-up is louder than one. */
interface Out {
  ctx: AudioContext;
  node: AudioNode;
  random: () => number;
}

/** A burst of filtered noise: a drum hit, a clap, a hiss. */
function hit(
  out: Out,
  at: number,
  options: {
    length: number;
    volume: number;
    filter: BiquadFilterType;
    frequency: number;
    q?: number;
  },
) {
  const { ctx } = out;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, options.length, out.random);
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter;
  filter.frequency.value = options.frequency;
  filter.Q.value = options.q ?? 1;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + options.length);
  source.connect(filter).connect(gain).connect(out.node);
  source.start(at);
  source.stop(at + options.length);
}

/** A pitched note: a pop, a bubble, a thud. */
function tone(
  out: Out,
  at: number,
  options: { from: number; to: number; length: number; volume: number; type?: OscillatorType },
) {
  const { ctx } = out;
  const oscillator = ctx.createOscillator();
  oscillator.type = options.type ?? 'sine';
  oscillator.frequency.setValueAtTime(options.from, at);
  oscillator.frequency.exponentialRampToValueAtTime(options.to, at + options.length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(options.volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + options.length);
  oscillator.connect(gain).connect(out.node);
  oscillator.start(at);
  oscillator.stop(at + options.length);
}

/** A brass note: a buzzing wave, softened, with a breath at the start; may waver. */
function brass(
  out: Out,
  at: number,
  options: { pitch: number; length: number; volume: number; vibrato?: number },
) {
  const { ctx } = out;
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sawtooth';
  oscillator.frequency.setValueAtTime(options.pitch, at);
  if (options.vibrato) {
    const wobble = ctx.createOscillator();
    const depth = ctx.createGain();
    wobble.frequency.value = 5.5;
    depth.gain.value = options.vibrato;
    wobble.connect(depth).connect(oscillator.frequency);
    wobble.start(at);
    wobble.stop(at + options.length);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0008, at);
  gain.gain.exponentialRampToValueAtTime(options.volume, at + 0.04);
  gain.gain.setValueAtTime(options.volume, at + options.length * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + options.length);
  oscillator.connect(filter).connect(gain).connect(out.node);
  oscillator.start(at);
  oscillator.stop(at + options.length);
}

function claps(out: Out, start: number, seconds: number, density: number) {
  for (let index = 0; index < seconds * density; index += 1) {
    const at = start + out.random() * seconds;
    const fade = 1 - (at - start) / seconds;
    hit(out, at, {
      length: 0.06,
      volume: 0.25 * (0.3 + 0.7 * fade),
      filter: 'bandpass',
      frequency: 1200 + out.random() * 1400,
      q: 0.8,
    });
  }
}

export type SoundName =
  | 'confetti'
  | 'drumroll'
  | 'bubbles'
  | 'micdrop'
  | 'quiet'
  | 'curtain'
  | 'applause'
  | 'fireworks'
  | 'balloons'
  | 'hearts'
  | 'fanfare'
  | 'womp';

/**
 * Plays a celebration's sound. `level` is how many are piled up (louder each time,
 * up to a point); `seed` and `variant` vary the pitch and the pattern from play to
 * play, the same way on every screen.
 */
export function playSound(
  name: SoundName,
  { level = 1, seed = '', variant = 0 }: { level?: number; seed?: string; variant?: number } = {},
): void {
  const ctx = context();
  if (!ctx) return;
  const volume = ctx.createGain();
  volume.gain.value = Math.min(2.2, 1 + 0.35 * (level - 1));
  volume.connect(ctx.destination);
  const random = seeded(seed || String(Math.random()));
  const out: Out = { ctx, node: volume, random };
  // Each play pitched a little differently: within a few semitones either way.
  const pitch = 2 ** ((random() * 6 - 3) / 12);
  const now = ctx.currentTime + 0.02;
  switch (name) {
    case 'confetti': {
      // A party popper, then a sprinkle — more of it the more it piles up.
      hit(out, now, {
        length: 0.18,
        volume: 0.6,
        filter: 'bandpass',
        frequency: 900 * pitch,
        q: 0.7,
      });
      const sprinkles = 5 + (variant % 4) + level * 2;
      for (let index = 0; index < sprinkles; index += 1) {
        tone(out, now + 0.12 + index * 0.06, {
          from: (1400 + random() * 1600) * pitch,
          to: (2400 + random() * 1200) * pitch,
          length: 0.12,
          volume: 0.06,
        });
      }
      return;
    }
    case 'drumroll': {
      // Snare strokes, ever faster and louder, then a cymbal and a kick.
      const length = 2.4;
      let at = now;
      while (at < now + length) {
        const progress = (at - now) / length;
        hit(out, at, {
          length: 0.07,
          volume: 0.12 + 0.3 * progress,
          filter: 'highpass',
          frequency: 1500 * pitch,
        });
        at += 0.065 - 0.035 * progress;
      }
      hit(out, now + length, { length: 1.8, volume: 0.45, filter: 'highpass', frequency: 5000 });
      tone(out, now + length, { from: 120 * pitch, to: 40, length: 0.5, volume: 0.7 });
      return;
    }
    case 'bubbles':
      for (let index = 0; index < 10 + level * 2; index += 1) {
        const note = (300 + random() * 500) * pitch;
        tone(out, now + index * 0.16 + random() * 0.08, {
          from: note,
          to: note * 2.6,
          length: 0.09,
          volume: 0.12,
        });
      }
      return;
    case 'micdrop':
      // A whistle as it falls, then the thud and the feedback hum.
      tone(out, now, { from: 1800 * pitch, to: 500, length: 0.6, volume: 0.05 });
      tone(out, now + 0.65, { from: 90 * pitch, to: 35, length: 0.6, volume: 0.9 });
      hit(out, now + 0.65, { length: 0.25, volume: 0.5, filter: 'lowpass', frequency: 600 });
      tone(out, now + 0.7, {
        from: 2200 * pitch,
        to: 2100 * pitch,
        length: 0.9,
        volume: 0.03,
        type: 'square',
      });
      return;
    case 'quiet':
      hit(out, now, { length: 1.3, volume: 0.22, filter: 'highpass', frequency: 3500 * pitch });
      return;
    case 'curtain':
      claps(out, now + 0.4, 3, 60 + level * 10);
      return;
    case 'applause':
      claps(out, now, 2.6, 45 + level * 10);
      return;
    case 'fireworks': {
      // Each rocket whistles up, bangs, and crackles as it falls.
      const rockets = 2 + (variant % 2) + Math.min(level, 3);
      for (let index = 0; index < rockets; index += 1) {
        const at = now + index * 0.55 + random() * 0.2;
        const high = (1600 + random() * 1200) * pitch;
        tone(out, at, { from: 500, to: high, length: 0.5, volume: 0.03 });
        hit(out, at + 0.52, { length: 0.7, volume: 0.6, filter: 'lowpass', frequency: 500 });
        tone(out, at + 0.52, { from: 80, to: 30, length: 0.4, volume: 0.4 });
        for (let spark = 0; spark < 14; spark += 1) {
          hit(out, at + 0.6 + random() * 0.9, {
            length: 0.03,
            volume: 0.08,
            filter: 'highpass',
            frequency: 4000,
          });
        }
      }
      return;
    }
    case 'balloons':
      // A rubbery squeak or two, then pops.
      for (let index = 0; index < 2; index += 1) {
        const note = (520 + random() * 200) * pitch;
        tone(out, now + index * 0.25, {
          from: note,
          to: note * 1.5,
          length: 0.18,
          volume: 0.05,
          type: 'triangle',
        });
      }
      for (let index = 0; index < 2 + level; index += 1) {
        hit(out, now + 1 + index * 0.35 + random() * 0.2, {
          length: 0.06,
          volume: 0.55,
          filter: 'bandpass',
          frequency: 1400 + random() * 800,
          q: 0.6,
        });
      }
      return;
    case 'hearts': {
      // A soft chime, rising: a major chord broken up, a different one each play.
      const chords = [
        [523, 659, 784, 1047],
        [587, 740, 880, 1175],
        [494, 622, 740, 988],
        [440, 554, 659, 880],
      ];
      const chord = chords[variant % chords.length]!;
      for (let round = 0; round < Math.min(level, 3); round += 1) {
        chord.forEach((note, index) => {
          tone(out, now + round * 0.6 + index * 0.13, {
            from: note * pitch,
            to: note * pitch * 1.002,
            length: 0.9,
            volume: 0.09,
          });
        });
      }
      return;
    }
    case 'fanfare': {
      // Three short calls and a long one.
      const tunes = [
        [392, 392, 392, 523],
        [523, 523, 523, 659],
        [349, 349, 349, 466],
      ];
      const tune = tunes[variant % tunes.length]!;
      const lengths = [0.13, 0.13, 0.13, 0.9];
      let at = now;
      tune.forEach((note, index) => {
        brass(out, at, { pitch: note * pitch, length: lengths[index]!, volume: 0.16 });
        // A second trumpet a third above, once it builds up.
        if (level > 1) {
          brass(out, at, { pitch: note * pitch * 1.26, length: lengths[index]!, volume: 0.1 });
        }
        at += lengths[index]! + 0.03;
      });
      return;
    }
    case 'womp': {
      // The sad trombone: four notes down, the last one wobbling.
      const start = [392, 370, 349, 330][variant % 4]! * pitch;
      const steps = [1, 0.944, 0.891, 0.841];
      steps.forEach((step, index) => {
        const last = index === steps.length - 1;
        brass(out, now + index * 0.5, {
          pitch: start * step,
          length: last ? 1.3 : 0.45,
          volume: 0.17,
          vibrato: last ? 9 : 0,
        });
      });
      return;
    }
  }
}
