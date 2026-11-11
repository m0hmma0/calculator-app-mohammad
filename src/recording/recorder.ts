import { create } from 'zustand';
import { audienceChannelName } from '@/workshop/audience';
import { useCamera } from './camera';
import { soundAlone, videoAlone, videoWithSound, type Format } from './formats';
import { toWav } from './wav';

/**
 * Recording presenter view's audience window: what the audience sees — the slides,
 * the camera on them, what is drawn and pointed at — with the slides' own sound and
 * the presenter's microphone mixed in. The browser asks which tab to record; the
 * audience window ("… — slides") is the one, and it is checked.
 *
 * Three files come out of one recording, made side by side as it runs: the video with
 * its sound, the video alone, and the sound alone (`formats.ts` says which kinds).
 * Nothing goes to the server: the files are kept in this window until downloaded.
 */
export type RecordingState = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing' | 'done';

export type OutputKind = 'video' | 'videoOnly' | 'sound';

export interface Output {
  kind: OutputKind;
  blob: Blob;
  extension: string;
}

interface RecorderStore {
  state: RecordingState;
  /** When the current stretch of recording began (performance.now()), while recording. */
  since: number | null;
  /** Recorded before the current stretch: pauses split a recording into stretches. */
  before: number;
  outputs: Output[];
  /** How long the finished recording is, in milliseconds. */
  length: number;
  error: string | null;
}

export const useRecorder = create<RecorderStore>(() => ({
  state: 'idle',
  since: null,
  before: 0,
  outputs: [],
  length: 0,
  error: null,
}));

/** How long has been recorded so far, in milliseconds. */
export function recordedMs(state: RecorderStore, now = performance.now()): number {
  return state.before + (state.since === null ? 0 : now - state.since);
}

/** A length as m:ss. */
export const clockText = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
};

const VIDEO_BITS = 4_000_000;
const SOUND_BITS = 160_000;
/** Recorders hand over what they have this often, so a long recording is not one buffer. */
const SLICE_MS = 1000;

interface Running {
  capture: MediaStream;
  audio: AudioContext;
  recorders: Array<{ kind: OutputKind; recorder: MediaRecorder; format: Format; toWav?: boolean }>;
  chunks: Map<OutputKind, Blob[]>;
}

let running: Running | null = null;

const fail = (error: string) => useRecorder.setState({ state: 'idle', error });

/**
 * Starts recording the audience window. Must run in the click that asked for it: the
 * browser only shows its "choose what to share" window then.
 */
export async function startRecording(): Promise<void> {
  const state = useRecorder.getState().state;
  if (state !== 'idle' && state !== 'done') return;
  const channel = audienceChannelName();
  if (!channel) return fail('Open presenter view first: the recording is of its audience window.');
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    return fail('This browser cannot record a tab. Chrome or Edge can.');
  }
  // Made inside the click, so it is allowed to run.
  const audio = new AudioContext();
  useRecorder.setState({ state: 'starting', error: null, outputs: [], before: 0, length: 0 });

  const { slideSound } = useCamera.getState();
  let capture: MediaStream;
  try {
    capture = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
        frameRate: { ideal: 30 },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
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

  // The slides' sound and the microphone, mixed into one.
  const mixed = audio.createMediaStreamDestination();
  let sources = 0;
  for (const stream of [capture, useCamera.getState().mic]) {
    if (stream && stream.getAudioTracks().length > 0) {
      audio.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(mixed);
      sources += 1;
    }
  }
  void audio.resume();
  const sound = sources > 0 ? mixed.stream.getAudioTracks()[0]! : null;

  const recorders: Running['recorders'] = [];
  const make = (
    kind: OutputKind,
    tracks: MediaStreamTrack[],
    format: Format | null,
    wav?: boolean,
  ) => {
    if (!format) return;
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: format.mimeType,
      videoBitsPerSecond: VIDEO_BITS,
      audioBitsPerSecond: SOUND_BITS,
    });
    recorders.push({ kind, recorder, format, toWav: wav });
  };
  if (sound) make('video', [video, sound], videoWithSound());
  make('videoOnly', [video.clone()], videoAlone());
  const soundFormat = soundAlone();
  if (sound) make('sound', [sound], soundFormat, soundFormat?.toWav);
  if (recorders.length === 0) {
    capture.getTracks().forEach((track) => track.stop());
    void audio.close();
    return fail('This browser cannot make a video file.');
  }

  const chunks = new Map<OutputKind, Blob[]>();
  for (const { kind, recorder } of recorders) {
    chunks.set(kind, []);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.get(kind)!.push(event.data);
    });
    recorder.start(SLICE_MS);
  }
  running = { capture, audio, recorders, chunks };
  // The tab closed, or "Stop sharing" was pressed: the recording ends there.
  video.addEventListener('ended', () => void stopRecording());
  useRecorder.setState({ state: 'recording', since: performance.now(), before: 0 });
}

export function pauseRecording(): void {
  const state = useRecorder.getState();
  if (!running || state.state !== 'recording') return;
  for (const { recorder } of running.recorders) recorder.pause();
  useRecorder.setState({ state: 'paused', since: null, before: recordedMs(state) });
}

export function resumeRecording(): void {
  if (!running || useRecorder.getState().state !== 'paused') return;
  for (const { recorder } of running.recorders) recorder.resume();
  useRecorder.setState({ state: 'recording', since: performance.now() });
}

/** Ends the recording and makes its files. */
export async function stopRecording(): Promise<void> {
  const current = running;
  if (!current) return;
  running = null;
  const length = recordedMs(useRecorder.getState());
  useRecorder.setState({ state: 'finishing', since: null, before: length, length });

  await Promise.all(
    current.recorders.map(
      ({ recorder }) =>
        new Promise<void>((resolve) => {
          if (recorder.state === 'inactive') return resolve();
          recorder.addEventListener('stop', () => resolve(), { once: true });
          recorder.stop();
        }),
    ),
  );
  current.capture.getTracks().forEach((track) => track.stop());
  for (const { recorder } of current.recorders) {
    recorder.stream.getTracks().forEach((track) => track.stop());
  }
  void current.audio.close();

  const outputs: Output[] = [];
  let problem: string | null = null;
  for (const { kind, format, toWav: wav } of current.recorders) {
    const recorded = new Blob(current.chunks.get(kind) ?? [], {
      type: format.mimeType.split(';')[0],
    });
    if (recorded.size === 0) continue;
    if (wav) {
      try {
        outputs.push({ kind, blob: await toWav(recorded), extension: 'wav' });
      } catch {
        problem = 'The sound on its own could not be made; the video with sound has it.';
      }
    } else {
      outputs.push({ kind, blob: recorded, extension: format.extension });
    }
  }
  useRecorder.setState({
    state: outputs.length > 0 ? 'done' : 'idle',
    outputs,
    error: outputs.length > 0 ? problem : 'Nothing was recorded.',
  });
}

/** Throws the finished files away. */
export function discardRecording(): void {
  if (running) return;
  useRecorder.setState({ state: 'idle', outputs: [], length: 0, before: 0, error: null });
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
