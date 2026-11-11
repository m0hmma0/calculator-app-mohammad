import { create } from 'zustand';
import { audienceChannelName } from '@/workshop/audience';
import { useCamera } from './camera';
import { chooseCodecs, RESOLUTIONS, type Resolution } from './formats';
import type { FromWorker, SoundName, ToWorker } from './workerProtocol';
import EncodeWorker from './encodeWorker?worker&inline';

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

  const outputs: Output[] = [];
  worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    if (message.t === 'source') {
      useRecorder.setState({ source: { width: message.width, height: message.height } });
    } else if (message.t === 'file') {
      const type =
        message.extension === 'ogg'
          ? 'audio/ogg'
          : message.extension === 'm4a'
            ? 'audio/mp4'
            : 'video/mp4';
      outputs.push({
        kind: message.kind as OutputKind,
        blob: new Blob([message.data], { type }),
        extension: message.extension,
      });
    } else if (message.t === 'done') {
      worker.terminate();
      useRecorder.setState({
        state: outputs.length > 0 ? 'done' : 'idle',
        outputs,
        length: message.length * 1000,
        error: outputs.length > 0 ? null : 'Nothing was recorded.',
      });
    } else if (message.t === 'error') {
      useRecorder.setState({ error: `Recording problem: ${message.message}` });
    }
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

/** Throws the finished files away. */
export function discardRecording(): void {
  if (running) return;
  useRecorder.setState({
    state: 'idle',
    outputs: [],
    length: 0,
    before: 0,
    error: null,
    source: null,
  });
}

/** Whether there is something that would be lost by closing the page. */
export function recordingAtStake(): boolean {
  const { state } = useRecorder.getState();
  return state !== 'idle';
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!recordingAtStake()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}
