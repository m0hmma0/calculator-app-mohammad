/// <reference lib="webworker" />
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
} from 'mediabunny';
import type { FromWorker, SoundName, ToWorker } from './workerProtocol';

/**
 * Turns the recorded tab and its sounds into files, off the page's main thread so a
 * busy or hidden presenter window does not stall it.
 *
 * The picture is taken at a steady frame rate whatever the tab does — a slide that
 * does not change still gets its frames — fitted into exactly the size asked for
 * (1280×720 or 1920×1080) on the dark surround, and encoded once as H.264 with a key
 * frame every two seconds. That one encoding goes into both videos. Each sound (the
 * mix, the microphone alone, the slides alone) is encoded once as AAC, or Opus where
 * the browser has no AAC encoder. When the recording stops, each file is written as a
 * plain MP4 (or M4A, or Ogg) with its index at the front: what editors such as Canva
 * expect, and what the browser's own recorder does not make.
 */
declare const self: DedicatedWorkerGlobalScope;

const SURROUND = '#101217';
const KEY_EVERY_S = 2;

interface Stored<M> {
  packets: EncodedPacket[];
  meta: M | undefined;
}

let width = 1920;
let height = 1080;
let fps = 30;
let paused = false;
let stopping = false;

/** Frames encoded so far, and the clock they are counted against. */
let emitted = 0;
let base = 0;
let since = 0;

let latest: VideoFrame | null = null;
let fresh = false;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let videoEncoder: VideoEncoder | null = null;
const video: Stored<EncodedVideoChunkMetadata> = { packets: [], meta: undefined };
let ticker: ReturnType<typeof setInterval> | null = null;
let sourceSize = '';

interface Sound {
  name: SoundName;
  encoder: AudioEncoder | null;
  /** Sound frames taken so far, which time the next piece. */
  frames: number;
  stored: Stored<EncodedAudioChunkMetadata>;
  codec: 'aac' | 'opus';
  done: Promise<void>;
}
const sounds: Sound[] = [];

const say = (message: FromWorker, transfer: Transferable[] = []) =>
  self.postMessage(message, transfer);

function fail(error: unknown) {
  say({ t: 'error', message: error instanceof Error ? error.message : String(error) });
}

/** Draws the newest picture from the tab, fitted, onto the frame being made. */
function paint() {
  if (!context || !latest) return;
  context.fillStyle = SURROUND;
  context.fillRect(0, 0, width, height);
  const scale = Math.min(width / latest.displayWidth, height / latest.displayHeight);
  const w = latest.displayWidth * scale;
  const h = latest.displayHeight * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(latest, (width - w) / 2, (height - h) / 2, w, h);
  fresh = false;
}

/** Makes every frame due by now — the same picture again if the tab has not changed. */
function tick() {
  if (paused || stopping || !latest || !videoEncoder || !canvas) return;
  const due = base + Math.floor(((performance.now() - since) * fps) / 1000);
  // Far behind (the computer slept): skip ahead rather than pour out a burst.
  if (due - emitted > fps) emitted = due - 1;
  while (emitted < due) {
    if (fresh) paint();
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((emitted * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    // An encoder that cannot keep up drops a repeat rather than fall further behind.
    if (videoEncoder.encodeQueueSize < 8 || emitted % (fps * KEY_EVERY_S) === 0) {
      videoEncoder.encode(frame, { keyFrame: emitted % (fps * KEY_EVERY_S) === 0 });
    }
    frame.close();
    emitted += 1;
  }
}

async function readVideo(stream: ReadableStream<VideoFrame>) {
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    latest?.close();
    latest = value;
    fresh = true;
    const size = `${value.displayWidth}x${value.displayHeight}`;
    if (size !== sourceSize) {
      sourceSize = size;
      say({ t: 'source', width: value.displayWidth, height: value.displayHeight });
    }
    if (stopping) break;
  }
}

/** A piece of sound, timed by how much sound came before it rather than the tab's clock. */
function retimed(data: AudioData, frames: number): AudioData {
  const channels = data.numberOfChannels;
  const samples = new Float32Array(data.numberOfFrames * channels);
  for (let plane = 0; plane < channels; plane += 1) {
    data.copyTo(samples.subarray(plane * data.numberOfFrames, (plane + 1) * data.numberOfFrames), {
      planeIndex: plane,
      format: 'f32-planar',
    });
  }
  return new AudioData({
    format: 'f32-planar',
    sampleRate: data.sampleRate,
    numberOfChannels: channels,
    numberOfFrames: data.numberOfFrames,
    timestamp: Math.round((frames * 1e6) / data.sampleRate),
    data: samples,
  });
}

async function readSound(sound: Sound, stream: ReadableStream<AudioData>) {
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    if (stopping) {
      value.close();
      break;
    }
    if (paused) {
      value.close();
      continue;
    }
    if (!sound.encoder) {
      sound.encoder = new AudioEncoder({
        output: (chunk, meta) => {
          sound.stored.packets.push(EncodedPacket.fromEncodedChunk(chunk));
          if (!sound.stored.meta && meta?.decoderConfig) sound.stored.meta = meta;
        },
        error: fail,
      });
      sound.encoder.configure({
        codec: sound.codec === 'aac' ? 'mp4a.40.2' : 'opus',
        sampleRate: value.sampleRate,
        numberOfChannels: value.numberOfChannels,
        bitrate: 128_000,
      });
    }
    const piece = retimed(value, sound.frames);
    sound.frames += value.numberOfFrames;
    value.close();
    sound.encoder.encode(piece);
    piece.close();
  }
}

/** One file: the given picture and sound, in order of time, written out whole. */
async function write(
  kind: 'mp4' | 'ogg',
  picture: Stored<EncodedVideoChunkMetadata> | null,
  sound: Sound | null,
): Promise<ArrayBuffer | null> {
  const target = new BufferTarget();
  const output = new Output({
    format:
      kind === 'ogg' ? new OggOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const pictureSource = picture?.packets.length ? new EncodedVideoPacketSource('avc') : null;
  const soundSource = sound?.stored.packets.length
    ? new EncodedAudioPacketSource(sound.codec)
    : null;
  if (pictureSource) output.addVideoTrack(pictureSource, { frameRate: fps });
  if (soundSource) output.addAudioTrack(soundSource);
  if (!pictureSource && !soundSource) return null;
  await output.start();

  // Interleaved by time, as a player reads them.
  const queue: Array<{ at: number; add: () => Promise<void> }> = [];
  picture?.packets.forEach((packet, index) =>
    queue.push({
      at: packet.timestamp,
      add: () => pictureSource!.add(packet, index === 0 ? picture.meta : undefined),
    }),
  );
  sound?.stored.packets.forEach((packet, index) =>
    queue.push({
      at: packet.timestamp,
      add: () => soundSource!.add(packet, index === 0 ? sound.stored.meta : undefined),
    }),
  );
  queue.sort((a, b) => a.at - b.at);
  for (const item of queue) await item.add();
  await output.finalize();
  return target.buffer;
}

async function finish() {
  stopping = true;
  if (ticker) clearInterval(ticker);
  try {
    await videoEncoder?.flush();
    for (const sound of sounds) await sound.encoder?.flush();
  } catch (error) {
    fail(error);
  }
  videoEncoder?.close();
  for (const sound of sounds) sound.encoder?.close();
  latest?.close();
  latest = null;

  const length = emitted / fps;
  const mix = sounds.find((sound) => sound.name === 'mix' && sound.stored.packets.length) ?? null;
  const jobs: Array<{ kind: string; make: () => Promise<ArrayBuffer | null>; ext: string }> = [];
  if (mix) jobs.push({ kind: 'video', make: () => write('mp4', video, mix), ext: 'mp4' });
  jobs.push({ kind: 'videoOnly', make: () => write('mp4', video, null), ext: 'mp4' });
  for (const sound of sounds) {
    if (!sound.stored.packets.length) continue;
    const ogg = sound.codec === 'opus';
    jobs.push({
      kind: sound.name,
      make: () => write(ogg ? 'ogg' : 'mp4', null, sound),
      ext: ogg ? 'ogg' : 'm4a',
    });
  }
  for (const job of jobs) {
    try {
      const data = await job.make();
      if (data) say({ t: 'file', kind: job.kind, data, extension: job.ext }, [data]);
    } catch (error) {
      fail(error);
    }
  }
  say({ t: 'done', length });
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.t === 'start') {
    ({ width, height, fps } = message);
    canvas = new OffscreenCanvas(width, height);
    context = canvas.getContext('2d', { alpha: false });
    videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        video.packets.push(EncodedPacket.fromEncodedChunk(chunk));
        if (!video.meta && meta?.decoderConfig) video.meta = meta;
      },
      error: fail,
    });
    videoEncoder.configure({
      codec: message.videoCodec,
      width,
      height,
      bitrate: message.bitrate,
      framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });
    since = performance.now();
    void readVideo(message.video).catch(fail);
    for (const { name, stream } of message.sounds) {
      const sound: Sound = {
        name,
        encoder: null,
        frames: 0,
        stored: { packets: [], meta: undefined },
        codec: message.aac ? 'aac' : 'opus',
        done: Promise.resolve(),
      };
      sound.done = readSound(sound, stream).catch(fail);
      sounds.push(sound);
    }
    ticker = setInterval(tick, 1000 / fps / 2);
  } else if (message.t === 'pause') {
    tick();
    paused = true;
    base = emitted;
  } else if (message.t === 'resume') {
    paused = false;
    since = performance.now();
    base = emitted;
  } else if (message.t === 'stop') {
    tick();
    void finish();
  }
});
