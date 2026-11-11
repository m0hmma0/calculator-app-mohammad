/**
 * What a recording is made as. Canva takes MP4 video and M4A or OGG sound, among
 * others: so the video is MP4 with H.264 picture — High profile, falling back to Main
 * and Baseline — and AAC sound where the browser can encode AAC (Chrome and Edge on
 * Windows and Mac), Opus where it cannot (Chromium on Linux). The sound on its own is
 * M4A (AAC) or OGG (Opus) to match.
 */
export type Resolution = 720 | 1080;

export const RESOLUTIONS: Record<Resolution, { width: number; height: number; bitrate: number }> = {
  720: { width: 1280, height: 720, bitrate: 4_000_000 },
  1080: { width: 1920, height: 1080, bitrate: 8_000_000 },
};

/** H.264 profiles to try, best first, per size (the level must allow the size). */
const VIDEO_CODECS: Record<number, string[]> = {
  720: ['avc1.64001f', 'avc1.4d001f', 'avc1.42e01f'],
  1080: ['avc1.640028', 'avc1.4d0028', 'avc1.42e028'],
};

type VideoCheck = (config: VideoEncoderConfig) => Promise<boolean>;
type AudioCheck = (config: AudioEncoderConfig) => Promise<boolean>;

const videoSupported: VideoCheck = async (config) =>
  typeof VideoEncoder !== 'undefined' &&
  ((await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported ?? false);

const audioSupported: AudioCheck = async (config) =>
  typeof AudioEncoder !== 'undefined' &&
  ((await AudioEncoder.isConfigSupported(config).catch(() => null))?.supported ?? false);

/** The video codec to use at this size, and whether the sound can be AAC. Null: no H.264. */
export async function chooseCodecs(
  size: { width: number; height: number; bitrate: number },
  checks: { video?: VideoCheck; audio?: AudioCheck } = {},
): Promise<{ video: string; aac: boolean } | null> {
  const video = checks.video ?? videoSupported;
  const audio = checks.audio ?? audioSupported;
  let chosen: string | null = null;
  for (const codec of VIDEO_CODECS[size.height] ?? VIDEO_CODECS[1080]!) {
    if (await video({ codec, width: size.width, height: size.height, bitrate: size.bitrate })) {
      chosen = codec;
      break;
    }
  }
  if (!chosen) return null;
  const aac = await audio({
    codec: 'mp4a.40.2',
    sampleRate: 48000,
    numberOfChannels: 2,
    bitrate: 128_000,
  });
  return { video: chosen, aac };
}
