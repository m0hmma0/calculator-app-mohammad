/** Messages between the recorder (`recorder.ts`) and its encoding worker (`encodeWorker.ts`). */

/** The sounds kept apart: both mixed, the microphone alone, the slides alone. */
export type SoundName = 'mix' | 'mic' | 'slides';

export type ToWorker =
  | {
      t: 'start';
      /** The recording's folder on disk (`storage.ts`). */
      id: string;
      title: string;
      width: number;
      height: number;
      fps: number;
      videoCodec: string;
      bitrate: number;
      /** AAC where the browser can make it; Opus otherwise. */
      aac: boolean;
      video: ReadableStream<VideoFrame>;
      sounds: Array<{ name: SoundName; stream: ReadableStream<AudioData> }>;
    }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'stop' }
  /** Make the files of a recording found on disk: one that stopped without them. */
  | { t: 'recover'; id: string };

export type FromWorker =
  | { t: 'source'; width: number; height: number }
  /** A finished file, in the recording's `out` folder. */
  | { t: 'file'; kind: string; file: string; extension: string }
  | { t: 'done'; id: string; length: number }
  /** How much of the recording is safe on disk, in seconds: put there for good. */
  | { t: 'stored'; seconds: number }
  /** The disk is full: what was recorded is kept, and the recording stops. */
  | { t: 'full' }
  | { t: 'error'; message: string };
