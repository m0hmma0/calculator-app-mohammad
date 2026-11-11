/** Messages between the recorder (`recorder.ts`) and its encoding worker (`encodeWorker.ts`). */

/** The sounds kept apart: both mixed, the microphone alone, the slides alone. */
export type SoundName = 'mix' | 'mic' | 'slides';

export type ToWorker =
  | {
      t: 'start';
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
  | { t: 'stop' };

export type FromWorker =
  | { t: 'source'; width: number; height: number }
  | { t: 'file'; kind: string; data: ArrayBuffer; extension: string }
  | { t: 'done'; length: number }
  | { t: 'error'; message: string };
