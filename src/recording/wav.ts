/**
 * A WAV file from decoded sound: 16-bit PCM, the channels interleaved. Used for the
 * sound on its own where the browser cannot make AAC, because WAV opens everywhere —
 * Canva included — at the cost of size (about 10 MB a minute in stereo).
 */
export interface Pcm {
  sampleRate: number;
  channels: Float32Array[];
}

export function encodeWav({ sampleRate, channels }: Pcm): ArrayBuffer {
  const count = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytes = frames * count * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < count; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      view.setInt16(at, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      at += 2;
    }
  }
  return buffer;
}

/** Decodes a recorded sound and writes it out as WAV. */
export async function toWav(recorded: Blob): Promise<Blob> {
  const context = new OfflineAudioContext(1, 1, 48000);
  const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
  const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, index) =>
    decoded.getChannelData(index),
  );
  return new Blob([encodeWav({ sampleRate: decoded.sampleRate, channels })], {
    type: 'audio/wav',
  });
}
