import type { Page } from '@playwright/test';

/** A second of a 440 Hz tone as a WAV file: 8 kHz, 16-bit mono. */
export function toneWav(): Buffer {
  const rate = 8000;
  const samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / rate) * 440 * Math.PI * 2) * 8000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

/**
 * A real, playable video: a second and a half of a moving square, recorded in the
 * page by the browser itself (a WebM, which every Chromium plays).
 */
export async function recordWebm(page: Page, hue = 200): Promise<Buffer> {
  const base64 = await page.evaluate(async (tint) => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(20);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start(100);
    const started = performance.now();
    await new Promise<void>((resolve) => {
      const draw = () => {
        const t = (performance.now() - started) / 1000;
        ctx.fillStyle = `hsl(${tint} 60% 45%)`;
        ctx.fillRect(0, 0, 160, 90);
        ctx.fillStyle = '#fff';
        ctx.fillRect(10 + t * 60, 30, 30, 30);
        if (t < 1.5) requestAnimationFrame(draw);
        else resolve();
      };
      draw();
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, hue);
  return Buffer.from(base64, 'base64');
}
