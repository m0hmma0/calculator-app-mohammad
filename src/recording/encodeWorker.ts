/// <reference lib="webworker" />
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import {
  configFromJson,
  configToJson,
  encodeHead,
  OUT_DIR,
  PacketReader,
  recordingsRoot,
  type RecordingMeta,
  type StoredPacket,
} from './storage';
import type { FromWorker, SoundName, ToWorker } from './workerProtocol';

/**
 * Turns the recorded tab and its sounds into files, off the page's main thread so a
 * busy or hidden presenter window does not stall it.
 *
 * The picture is taken at a steady frame rate whatever the tab does — a slide that
 * does not change still gets its frames — fitted into exactly the size asked for
 * (1280×720 or 1920×1080) on the dark surround, and encoded once as H.264 with a key
 * frame every two seconds. Each sound (the mix, the microphone alone, the slides alone)
 * is encoded once, as AAC, or Opus where the browser has no AAC encoder.
 *
 * Every encoded piece goes straight to disk (`storage.ts`) and is put there for good
 * every second, so a crash, a closed tab or a flat battery loses a second at most; the
 * files are made from what is on disk, at Stop or when a stopped recording is
 * recovered, and written to disk too — however long the recording, it is never all
 * in memory.
 */
declare const self: DedicatedWorkerGlobalScope;

const SURROUND = '#101217';
const KEY_EVERY_S = 2;
const FLUSH_MS = 1000;

/** A run of encoded pieces on disk, with how to decode them. */
class PacketLog {
  private at = 0;
  private configured = false;
  /** The end of the last piece written, in seconds, and of the last put to disk for good. */
  written = 0;
  stored = 0;
  constructor(
    private readonly handle: FileSystemSyncAccessHandle,
    private readonly configHandle: FileSystemSyncAccessHandle,
  ) {}

  static async open(dir: FileSystemDirectoryHandle, name: string): Promise<PacketLog> {
    const bin = await dir.getFileHandle(`${name}.bin`, { create: true });
    const json = await dir.getFileHandle(`${name}.json`, { create: true });
    return new PacketLog(await bin.createSyncAccessHandle(), await json.createSyncAccessHandle());
  }

  /** Throws when the disk is full. */
  add(
    chunk: EncodedVideoChunk | EncodedAudioChunk,
    config?: VideoDecoderConfig | AudioDecoderConfig,
  ) {
    if (!this.configured && config) {
      const bytes = new TextEncoder().encode(configToJson(config));
      this.configHandle.truncate(0);
      this.configHandle.write(bytes, { at: 0 });
      this.configHandle.flush();
      this.configured = true;
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    const head = encodeHead(
      { key: chunk.type === 'key', timestamp: chunk.timestamp, duration: chunk.duration ?? 0 },
      data.length,
    );
    this.at += this.handle.write(head, { at: this.at });
    this.at += this.handle.write(data, { at: this.at });
    this.written = Math.max(this.written, (chunk.timestamp + (chunk.duration ?? 0)) / 1e6);
  }

  flush() {
    this.handle.flush();
    this.stored = this.written;
  }

  close() {
    this.handle.flush();
    this.handle.close();
    this.configHandle.close();
  }
}

let width = 1920;
let height = 1080;
let fps = 30;
let paused = false;
let stopping = false;
let full = false;

/** Frames encoded so far, and the clock they are counted against. */
let emitted = 0;
let base = 0;
let since = 0;

let latest: VideoFrame | null = null;
let fresh = false;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let videoEncoder: VideoEncoder | null = null;
let videoLog: PacketLog | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let flusher: ReturnType<typeof setInterval> | null = null;
let sourceSize = '';
let dir: FileSystemDirectoryHandle | null = null;
let meta: RecordingMeta | null = null;

interface Sound {
  name: SoundName;
  encoder: AudioEncoder | null;
  /** Sound frames taken so far, which time the next piece. */
  frames: number;
  log: PacketLog;
  codec: 'aac' | 'opus';
}
const sounds: Sound[] = [];

const say = (message: FromWorker) => self.postMessage(message);

function fail(error: unknown) {
  say({ t: 'error', message: error instanceof Error ? error.message : String(error) });
}

/** Writing to disk failed: the disk is full. Keep what is there and stop. */
function diskFull() {
  if (full) return;
  full = true;
  say({ t: 'full' });
}

function keep(
  log: PacketLog | null,
  chunk: EncodedVideoChunk | EncodedAudioChunk,
  config?: VideoDecoderConfig | AudioDecoderConfig,
) {
  if (!log || full) return;
  try {
    log.add(chunk, config);
  } catch {
    diskFull();
  }
}

async function writeMeta() {
  if (!dir || !meta) return;
  const file = await dir.getFileHandle('meta.json', { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(meta));
  await writable.close();
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
  if (paused || stopping || full || !latest || !videoEncoder || !canvas) return;
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
    if (paused || full) {
      value.close();
      continue;
    }
    if (!sound.encoder) {
      sound.encoder = new AudioEncoder({
        output: (chunk, chunkMeta) => keep(sound.log, chunk, chunkMeta?.decoderConfig),
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

/* ------------------------------ making the files ------------------------------ */

async function readConfig<T extends VideoDecoderConfig | AudioDecoderConfig>(
  folder: FileSystemDirectoryHandle,
  name: string,
): Promise<T | null> {
  try {
    const text = await (await (await folder.getFileHandle(`${name}.json`)).getFile()).text();
    return text ? configFromJson<T>(text) : null;
  } catch {
    return null;
  }
}

async function readerOf(
  folder: FileSystemDirectoryHandle,
  name: string,
): Promise<PacketReader | null> {
  try {
    return new PacketReader(await (await folder.getFileHandle(`${name}.bin`)).getFile());
  } catch {
    return null;
  }
}

const packetOf = (stored: StoredPacket) =>
  new EncodedPacket(
    stored.data,
    stored.key ? 'key' : 'delta',
    stored.timestamp / 1e6,
    stored.duration / 1e6,
  );

/**
 * One file, written to `out/<name>` on disk as it is made: the picture and the sound
 * given, in order of time. MP4 with its index at the end, so nothing need be held back.
 */
async function writeFile(
  folder: FileSystemDirectoryHandle,
  name: string,
  kind: 'mp4' | 'ogg',
  picture: string | null,
  sound: { name: string; codec: 'aac' | 'opus' } | null,
): Promise<number> {
  const videoConfig = picture ? await readConfig<VideoDecoderConfig>(folder, picture) : null;
  const soundConfig = sound
    ? await readConfig<AudioDecoderConfig>(folder, `sound-${sound.name}`)
    : null;
  const videoReader = videoConfig && picture ? await readerOf(folder, picture) : null;
  const soundReader = soundConfig && sound ? await readerOf(folder, `sound-${sound.name}`) : null;
  if (!videoReader && !soundReader) return 0;

  const out = await folder.getDirectoryHandle(OUT_DIR, { create: true });
  const handle = await (await out.getFileHandle(name, { create: true })).createSyncAccessHandle();
  handle.truncate(0);
  const writable = new WritableStream<StreamTargetChunk>({
    write(chunk) {
      handle.write(chunk.data, { at: chunk.position });
    },
  });
  const output = new Output({
    format: kind === 'ogg' ? new OggOutputFormat() : new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable),
  });
  const pictureSource = videoReader ? new EncodedVideoPacketSource('avc') : null;
  const soundSource = soundReader && sound ? new EncodedAudioPacketSource(sound.codec) : null;
  if (pictureSource) output.addVideoTrack(pictureSource, { frameRate: meta?.fps ?? fps });
  if (soundSource) output.addAudioTrack(soundSource);
  await output.start();

  // The two runs interleaved by time, as a player reads them.
  let nextPicture = videoReader ? await videoReader.next() : null;
  let nextSound = soundReader ? await soundReader.next() : null;
  let firstPicture = true;
  let firstSound = true;
  let end = 0;
  while (nextPicture || nextSound) {
    const takePicture = nextPicture && (!nextSound || nextPicture.timestamp <= nextSound.timestamp);
    if (takePicture && nextPicture && pictureSource) {
      await pictureSource.add(
        packetOf(nextPicture),
        firstPicture ? { decoderConfig: videoConfig! } : undefined,
      );
      firstPicture = false;
      end = Math.max(end, (nextPicture.timestamp + nextPicture.duration) / 1e6);
      nextPicture = await videoReader!.next();
    } else if (nextSound && soundSource) {
      await soundSource.add(
        packetOf(nextSound),
        firstSound ? { decoderConfig: soundConfig! } : undefined,
      );
      firstSound = false;
      end = Math.max(end, (nextSound.timestamp + nextSound.duration) / 1e6);
      nextSound = await soundReader!.next();
    } else {
      break;
    }
  }
  await output.finalize();
  handle.flush();
  handle.close();
  return end;
}

/** Makes every file of the recording in `folder`, from what is on disk. */
async function makeFiles(folder: FileSystemDirectoryHandle) {
  const recorded = JSON.parse(
    await (await (await folder.getFileHandle('meta.json')).getFile()).text(),
  ) as RecordingMeta;
  meta = recorded;
  const codec = recorded.aac ? 'aac' : 'opus';
  const soundExtension = recorded.aac ? 'm4a' : 'ogg';
  const made: NonNullable<RecordingMeta['made']> = [];
  let length = recorded.finished?.length ?? 0;
  const jobs: Array<{ kind: string; file: string; extension: string; run: () => Promise<number> }> =
    [];
  if (recorded.sounds.includes('mix')) {
    jobs.push({
      kind: 'video',
      file: 'video.mp4',
      extension: 'mp4',
      run: () => writeFile(folder, 'video.mp4', 'mp4', 'video', { name: 'mix', codec }),
    });
  }
  jobs.push({
    kind: 'videoOnly',
    file: 'video-only.mp4',
    extension: 'mp4',
    run: () => writeFile(folder, 'video-only.mp4', 'mp4', 'video', null),
  });
  for (const name of recorded.sounds) {
    jobs.push({
      kind: name,
      file: `sound-${name}.${soundExtension}`,
      extension: soundExtension,
      run: () =>
        writeFile(folder, `sound-${name}.${soundExtension}`, recorded.aac ? 'mp4' : 'ogg', null, {
          name,
          codec,
        }),
    });
  }
  for (const job of jobs) {
    try {
      const end = await job.run();
      if (end <= 0) continue;
      length = Math.max(length, end);
      made.push({ kind: job.kind, file: job.file, extension: job.extension });
      say({ t: 'file', kind: job.kind, file: job.file, extension: job.extension });
    } catch (error) {
      fail(error);
    }
  }
  recorded.made = made;
  recorded.finished = { length };
  dir = folder;
  await writeMeta();
  say({ t: 'done', id: recorded.id, length });
}

async function finish() {
  stopping = true;
  if (ticker) clearInterval(ticker);
  if (flusher) clearInterval(flusher);
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
  videoLog?.close();
  for (const sound of sounds) sound.log.close();
  if (meta && dir) {
    meta.finished = { length: emitted / fps };
    await writeMeta();
    await makeFiles(dir);
  }
}

async function start(message: Extract<ToWorker, { t: 'start' }>) {
  ({ width, height, fps } = message);
  dir = await (await recordingsRoot()).getDirectoryHandle(message.id, { create: true });
  meta = {
    id: message.id,
    startedAt: Date.now(),
    width,
    height,
    fps,
    aac: message.aac,
    sounds: message.sounds.map((each) => each.name),
    title: message.title,
  };
  await writeMeta();
  videoLog = await PacketLog.open(dir, 'video');
  canvas = new OffscreenCanvas(width, height);
  context = canvas.getContext('2d', { alpha: false });
  videoEncoder = new VideoEncoder({
    output: (chunk, chunkMeta) => keep(videoLog, chunk, chunkMeta?.decoderConfig),
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
  for (const { name, stream } of message.sounds) {
    const sound: Sound = {
      name,
      encoder: null,
      frames: 0,
      log: await PacketLog.open(dir, `sound-${name}`),
      codec: message.aac ? 'aac' : 'opus',
    };
    sounds.push(sound);
    void readSound(sound, stream).catch(fail);
  }
  since = performance.now();
  void readVideo(message.video).catch(fail);
  ticker = setInterval(tick, 1000 / fps / 2);
  // Put to disk for good every second: what a crash can take is the last second.
  flusher = setInterval(() => {
    try {
      videoLog?.flush();
      for (const sound of sounds) sound.log.flush();
      say({ t: 'stored', seconds: videoLog?.stored ?? 0 });
    } catch {
      diskFull();
    }
  }, FLUSH_MS);
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.t === 'start') {
    void start(message).catch(fail);
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
    void finish().catch(fail);
  } else if (message.t === 'recover') {
    void (async () => {
      const folder = await (await recordingsRoot()).getDirectoryHandle(message.id);
      await makeFiles(folder);
    })().catch(fail);
  }
});
