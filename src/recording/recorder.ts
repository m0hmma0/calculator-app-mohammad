import { create } from 'zustand';
import { audienceChannelName } from '@/workshop/audience';
import { useCamera } from './camera';
import { chooseCodecs, RESOLUTIONS, type Resolution } from './formats';
import type { FromWorker, SoundName, ToWorker } from './workerProtocol';
import EncodeWorker from './encodeWorker?worker&inline';
import { allowRecordingFolder, saveToRecordingFolder } from './folder';
import {
  discardRecordingFiles,
  holdRecording,
  keepRecordings,
  recordingFile,
  recordingSpace,
  releaseRecording,
  type Unsaved,
} from './recovery';

/**
 * Recording presenter view's audience window: what the audience sees — the slides,
 * the camera on them, what is drawn and pointed at — with the slides' own sound and
 * the presenter's microphone. The browser asks which tab to record; the audience
 * window ("… — slides") is the one.
 *
 * The tab's picture and the sounds go to a worker (`encodeWorker.ts`) that makes the
 * files: exactly 1280×720 or 1920×1080 at a steady 30 frames a second, one H.264
 * encoding used for both videos, and each sound — the mix, the microphone alone, the
 * slides alone — encoded once. Nothing goes to the server: the files are kept in this
 * window until downloaded.
 */
export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'done';

export type OutputKind = 'video' | 'videoOnly' | SoundName;

export interface Output {
  kind: OutputKind;
  blob: Blob;
  extension: string;
}

interface RecorderStore {
  state: RecordingState;
  /** The size of the files, chosen before recording. */
  resolution: Resolution;
  /** When the current stretch of recording began (performance.now()), while recording. */
  since: number | null;
  /** Recorded before the current stretch: pauses split a recording into stretches. */
  before: number;
  /** The recorded tab's own size, as it arrives; smaller than the files means less sharp. */
  source: { width: number; height: number } | null;
  outputs: Output[];
  /** How long the finished recording is, in milliseconds. */
  length: number;
  error: string | null;
  /** The recording on disk (`storage.ts`) being made or shown. */
  recordingId: string | null;
  /** The board's name and when it began, for the files' names. */
  title: string;
  startedAt: number;
  /** The folder the files were saved to by themselves, once they are. */
  savedTo: string | null;
  /** How much of the recording being made is safe on disk, in seconds. */
  stored: number;
  /** Free room for recordings on this computer, in bytes, and whether it is kept. */
  space: { free: number; kept: boolean } | null;
}

const RESOLUTION_KEY = 'sabboura:recording-resolution';

function loadResolution(): Resolution {
  try {
    return localStorage.getItem(RESOLUTION_KEY) === '720' ? 720 : 1080;
  } catch {
    return 1080;
  }
}

export const useRecorder = create<RecorderStore>(() => ({
  state: 'idle',
  resolution: typeof localStorage === 'undefined' ? 1080 : loadResolution(),
  since: null,
  before: 0,
  source: null,
  outputs: [],
  length: 0,
  error: null,
  recordingId: null,
  title: '',
  startedAt: 0,
  savedTo: null,
  stored: 0,
  space: null,
}));

export function setResolution(resolution: Resolution): void {
  useRecorder.setState({ resolution });
  try {
    localStorage.setItem(RESOLUTION_KEY, String(resolution));
  } catch {
    // Still used; just not remembered.
  }
}

/** How long has been recorded so far, in milliseconds. */
export function recordedMs(
  state: Pick<RecorderStore, 'before' | 'since'>,
  now = performance.now(),
): number {
  return state.before + (state.since === null ? 0 : now - state.since);
}

/** A length as m:ss. */
export const clockText = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

const FPS = 30;

interface Running {
  capture: MediaStream;
  audio: AudioContext;
  worker: Worker;
  /** Tracks made here for the worker, stopped at the end. */
  made: MediaStreamTrack[];
}

let running: Running | null = null;

const fail = (error: string) => useRecorder.setState({ state: 'idle', error });

type Processor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream };

/**
 * Starts recording the audience window. Must run in the click that asked for it: the
 * browser only shows its "choose what to share" window then.
 */
export async function startRecording(): Promise<void> {
  const state = useRecorder.getState().state;
  if (state !== 'idle' && state !== 'done') return;
  const channel = audienceChannelName();
  if (!channel) return fail('Open presenter view first: the recording is of its audience window.');
  const TrackProcessor = (window as Window & { MediaStreamTrackProcessor?: Processor })
    .MediaStreamTrackProcessor;
  if (
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof VideoEncoder === 'undefined' ||
    !TrackProcessor
  ) {
    return fail('This browser cannot record here. Chrome or Edge can.');
  }
  // Made inside the click, so it is allowed to run.
  const audio = new AudioContext();
  // Kept on disk as it is made; the browser is asked not to clear it to make room.
  void keepRecordings().then(() =>
    recordingSpace().then((space) => useRecorder.setState({ space })),
  );
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const title = document.title.replace(/ · Sabboura$/, '') || 'Recording';
  const { resolution } = useRecorder.getState();
  const size = RESOLUTIONS[resolution];
  useRecorder.setState({
    state: 'starting',
    error: null,
    outputs: [],
    before: 0,
    length: 0,
    source: null,
  });

  const { slideSound } = useCamera.getState();
  let capture: MediaStream;
  try {
    capture = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
        frameRate: { ideal: FPS },
        width: { ideal: size.width },
        height: { ideal: size.height },
      },
      audio: slideSound ? { suppressLocalAudioPlayback: false } : false,
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      systemAudio: 'exclude',
      monitorTypeSurfaces: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch {
    void audio.close();
    return fail('Nothing was recorded: the browser was not given a tab to record.');
  }

  // A tab, not a window or a screen. Where the browser says which tab (the audience
  // window gives its channel as a capture handle), anything else is let go again;
  // Chromium does not always say, and then the tab chosen is taken on trust.
  const video = capture.getVideoTracks()[0] as
    (MediaStreamTrack & { getCaptureHandle?: () => { handle?: string } | null }) | undefined;
  const surface = (video?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  const handle = video?.getCaptureHandle?.()?.handle;
  if (!video || (surface && surface !== 'browser') || (handle && handle !== channel)) {
    capture.getTracks().forEach((track) => track.stop());
    void audio.close();
    return fail(
      'That was not the slides window. Record again and choose the tab ending “— slides”.',
    );
  }

  const codecs = await chooseCodecs(size);
  if (!codecs) {
    capture.getTracks().forEach((track) => track.stop());
    void audio.close();
    return fail('This browser cannot make an H.264 video. Chrome or Edge can.');
  }

  // Each sound through the audio graph, so it runs on through silence and keeps time:
  // the slides alone, the microphone alone, and the two mixed.
  const slides: MediaStreamTrack | null = capture.getAudioTracks()[0] ?? null;
  const mic: MediaStreamTrack | null = useCamera.getState().mic?.getAudioTracks()[0] ?? null;
  const made: MediaStreamTrack[] = [];
  const through = (inputs: MediaStreamTrack[]) => {
    const out = audio.createMediaStreamDestination();
    for (const input of inputs) {
      audio.createMediaStreamSource(new MediaStream([input])).connect(out);
    }
    const track = out.stream.getAudioTracks()[0]!;
    made.push(track);
    return track;
  };
  const sounds: Array<{ name: SoundName; track: MediaStreamTrack }> = [];
  const present = [slides, mic].filter((track): track is MediaStreamTrack => track !== null);
  if (present.length > 0) sounds.push({ name: 'mix', track: through(present) });
  if (mic) sounds.push({ name: 'mic', track: through([mic]) });
  if (slides) sounds.push({ name: 'slides', track: through([slides]) });
  void audio.resume();

  const worker = new EncodeWorker();
  const videoStream = new TrackProcessor({ track: video }).readable;
  const soundStreams = sounds.map(({ name, track }) => ({
    name,
    stream: new TrackProcessor({ track }).readable as ReadableStream<AudioData>,
  }));
  const start: ToWorker = {
    t: 'start',
    id,
    title,
    width: size.width,
    height: size.height,
    fps: FPS,
    videoCodec: codecs.video,
    bitrate: size.bitrate,
    aac: codecs.aac,
    video: videoStream as ReadableStream<VideoFrame>,
    sounds: soundStreams,
  };
  worker.postMessage(start, [videoStream, ...soundStreams.map((each) => each.stream)]);

  holdRecording(id);
  listen(worker, id);
  useRecorder.setState({
    recordingId: id,
    title,
    startedAt: Date.now(),
    savedTo: null,
    stored: 0,
  });

  running = { capture, audio, worker, made };
  // The tab closed, or "Stop sharing" was pressed: the recording ends there.
  video.addEventListener('ended', () => void stopRecording());
  useRecorder.setState({ state: 'recording', since: performance.now(), before: 0 });
}

export function pauseRecording(): void {
  const state = useRecorder.getState();
  if (!running || state.state !== 'recording') return;
  running.worker.postMessage({ t: 'pause' } satisfies ToWorker);
  useRecorder.setState({ state: 'paused', since: null, before: recordedMs(state) });
}

export function resumeRecording(): void {
  if (!running || useRecorder.getState().state !== 'paused') return;
  running.worker.postMessage({ t: 'resume' } satisfies ToWorker);
  useRecorder.setState({ state: 'recording', since: performance.now() });
}

/** Ends the recording; the worker sends its files, then says it is done. */
export async function stopRecording(): Promise<void> {
  const current = running;
  if (!current) return;
  running = null;
  // In the click: the browser may want to ask again before the app writes to the folder.
  void allowRecordingFolder();
  const length = recordedMs(useRecorder.getState());
  useRecorder.setState({ state: 'finishing', since: null, before: length, length });
  current.worker.postMessage({ t: 'stop' } satisfies ToWorker);
  // The worker is told first, so it takes the last of the picture and sound before
  // the tracks end.
  await new Promise((resolve) => setTimeout(resolve, 150));
  current.capture.getTracks().forEach((track) => track.stop());
  current.made.forEach((track) => track.stop());
  void current.audio.close();
}

/**
 * Puts the finished files away without deleting them: they stay on disk, and are offered
 * again next time (the lock goes, so they show as left over).
 */
export function putAwayRecording(): void {
  if (running) return;
  const { recordingId } = useRecorder.getState();
  if (recordingId) releaseRecording(recordingId);
  useRecorder.setState({
    state: 'idle',
    outputs: [],
    length: 0,
    before: 0,
    error: null,
    source: null,
    recordingId: null,
    savedTo: null,
  });
}

/** Throws the finished files away. */
export function discardRecording(): void {
  if (running) return;
  const { recordingId } = useRecorder.getState();
  if (recordingId) void discardRecordingFiles(recordingId);
  useRecorder.setState({
    recordingId: null,
    savedTo: null,
    state: 'idle',
    outputs: [],
    length: 0,
    before: 0,
    error: null,
    source: null,
  });
}

/**
 * Whether closing the page now would cut something short: a recording being made or
 * its files being made. (Finished files are on disk, and offered again next time.)
 */
export function recordingAtStake(): boolean {
  const { state } = useRecorder.getState();
  return (
    state === 'recording' || state === 'paused' || state === 'finishing' || state === 'starting'
  );
}

const KINDS_SUFFIX: Record<string, string> = {
  video: '',
  videoOnly: ' (video only)',
  mix: ' (sound only)',
  mic: ' (microphone)',
  slides: ' (slides sound)',
};

/** A file's name: the board, when it was recorded, and which file it is. */
export function fileName(
  kind: string,
  extension: string,
  title: string,
  startedAt: number,
): string {
  const when = new Date(startedAt || Date.now());
  const stamp = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(
    when.getDate(),
  ).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}.${String(
    when.getMinutes(),
  ).padStart(2, '0')}`;
  const base = `${title} ${stamp}`
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'Recording'}${KINDS_SUFFIX[kind] ?? ` (${kind})`}.${extension}`;
}

/**
 * What the worker says about a recording's files, at Stop or on recovery: each file
 * from disk as it is made, then — all made — shown, and saved to the folder if one is
 * chosen. The disk being full stops the recording, keeping what there is.
 */
function listen(worker: Worker, id: string) {
  const outputs: Output[] = [];
  const reading: Array<Promise<unknown>> = [];
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.t === 'source') {
      useRecorder.setState({ source: { width: message.width, height: message.height } });
    } else if (message.t === 'stored') {
      useRecorder.setState({ stored: message.seconds });
    } else if (message.t === 'file') {
      reading.push(
        recordingFile(id, message.file).then((file) =>
          outputs.push({
            kind: message.kind as OutputKind,
            blob: file,
            extension: message.extension,
          }),
        ),
      );
    } else if (message.t === 'done') {
      // Each file is read from disk as its message comes; all of them, then on.
      void Promise.allSettled(reading).then(async () => {
        worker.terminate();
        const { title, startedAt } = useRecorder.getState();
        useRecorder.setState({
          state: outputs.length > 0 ? 'done' : 'idle',
          outputs: [...outputs],
          length: message.length * 1000,
          error: outputs.length > 0 ? null : 'Nothing was recorded.',
        });
        if (outputs.length === 0) return discardRecordingFiles(id);
        try {
          const savedTo = await saveToRecordingFolder(
            outputs.map((output) => ({
              name: fileName(output.kind, output.extension, title, startedAt),
              blob: output.blob,
            })),
          );
          if (useRecorder.getState().recordingId === id) useRecorder.setState({ savedTo });
        } catch {
          useRecorder.setState({
            error: 'The files could not be saved to the folder. Download them below.',
          });
        }
      });
    } else if (message.t === 'full') {
      useRecorder.setState({
        error:
          'This computer’s disk is full: the recording stopped there. What was recorded is kept.',
      });
      void stopRecording();
    } else if (message.t === 'error') {
      useRecorder.setState({ error: `Recording problem: ${message.message}` });
    }
  });
}

/**
 * Makes the files of a recording left on disk by an earlier visit, and shows them as a
 * finished recording is shown. Run from a click: the folder may need asking again.
 */
export async function recoverRecording(unsaved: Unsaved): Promise<void> {
  const state = useRecorder.getState().state;
  if (state !== 'idle' && state !== 'done') return;
  void allowRecordingFolder();
  holdRecording(unsaved.id);
  useRecorder.setState({
    state: 'finishing',
    recordingId: unsaved.id,
    title: unsaved.title,
    startedAt: unsaved.startedAt,
    savedTo: null,
    error: null,
    outputs: [],
  });
  const worker = new EncodeWorker();
  listen(worker, unsaved.id);
  worker.postMessage({ t: 'recover', id: unsaved.id } satisfies ToWorker);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!recordingAtStake()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
