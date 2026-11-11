/**
 * What a recording is saved as. Canva takes MP4 video and M4A, MP3 or WAV sound, so
 * those come first: MP4 with H.264 picture and AAC sound where the browser can make
 * them (Chrome and Edge on Windows and Mac), MP4 with Opus sound where it has no AAC
 * encoder (Chromium on Linux), and WebM only from a browser that makes no MP4 at all.
 * Sound on its own is M4A where AAC can be made, and otherwise WAV, which is worked
 * out here from the recording (`wav.ts`) — never a WebM sound, which Canva refuses.
 */
export interface Format {
  mimeType: string;
  extension: string;
}

const VIDEO_WITH_SOUND: Format[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1.640028,opus', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1,opus', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

const VIDEO_ALONE: Format[] = [
  { mimeType: 'video/mp4;codecs=avc1.640028', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
];

/** Recorded as these, then saved as M4A as it is, or turned into WAV. */
const SOUND: Array<Format & { toWav: boolean }> = [
  { mimeType: 'audio/mp4;codecs=mp4a.40.2', extension: 'm4a', toWav: false },
  { mimeType: 'audio/webm;codecs=opus', extension: 'wav', toWav: true },
  { mimeType: 'audio/mp4;codecs=opus', extension: 'wav', toWav: true },
];

type Supports = (mimeType: string) => boolean;

const supported: Supports = (type) =>
  typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);

export function videoWithSound(supports: Supports = supported): Format | null {
  return VIDEO_WITH_SOUND.find((format) => supports(format.mimeType)) ?? null;
}

export function videoAlone(supports: Supports = supported): Format | null {
  return VIDEO_ALONE.find((format) => supports(format.mimeType)) ?? null;
}

export function soundAlone(supports: Supports = supported): (Format & { toWav: boolean }) | null {
  return SOUND.find((format) => supports(format.mimeType)) ?? null;
}
