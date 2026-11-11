import { useEffect, useMemo, useState } from 'react';
import {
  clockText,
  discardRecording,
  useRecorder,
  type Output,
  type OutputKind,
} from '@/recording/recorder';
import styles from './RecordingResult.module.css';

const LABEL: Record<OutputKind, string> = {
  video: 'Video with sound',
  videoOnly: 'Video only',
  mix: 'Sound only — microphone and slides',
  mic: 'Sound only — microphone',
  slides: 'Sound only — slides’ sound',
};

const SUFFIX: Record<OutputKind, string> = {
  video: '',
  videoOnly: ' (video only)',
  mix: ' (sound only)',
  mic: ' (microphone)',
  slides: ' (slides sound)',
};

/** In this order, whatever order they were made in. */
const ORDER: OutputKind[] = ['video', 'videoOnly', 'mix', 'mic', 'slides'];

/** Between one file and the next of "Download all", so the browser takes each. */
const BETWEEN_MS = 400;

const size = (bytes: number) =>
  bytes > 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes > 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

/** A file name a person (and Canva) is happy with: no slashes, colons or the like. */
const safeName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'Recording';

/**
 * A finished recording: its three files to download — the video with sound, the video
 * alone, the sound alone — then close. They are only in this window until then.
 */
export function RecordingResult() {
  const state = useRecorder((current) => current.state);
  const outputs = useRecorder((current) => current.outputs);
  if (state !== 'done' || outputs.length === 0) return null;
  // A new recording starts with nothing downloaded.
  return <Files key={outputs.map((output) => output.blob.size).join('-')} outputs={outputs} />;
}

function Files({ outputs }: { outputs: Output[] }) {
  const length = useRecorder((current) => current.length);
  const error = useRecorder((current) => current.error);
  const [saved, setSaved] = useState<OutputKind[]>([]);

  const links = useMemo(
    () =>
      [...outputs]
        .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
        .map((output) => ({ ...output, url: URL.createObjectURL(output.blob) })),
    [outputs],
  );
  const [allRunning, setAllRunning] = useState(false);
  useEffect(() => () => links.forEach((link) => URL.revokeObjectURL(link.url)), [links]);

  const base = safeName(
    `${document.title.replace(/ · Sabboura$/, '')} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}`,
  );
  const nameOf = (link: (typeof links)[number]) => `${base}${SUFFIX[link.kind]}.${link.extension}`;

  // One after the other: the browser may ask once whether this site may download
  // several files.
  const downloadAll = async () => {
    setAllRunning(true);
    for (const link of links) {
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.download = nameOf(link);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setSaved((done) => (done.includes(link.kind) ? done : [...done, link.kind]));
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_MS));
    }
    setAllRunning(false);
  };

  const close = () => {
    if (
      saved.length < links.length &&
      !window.confirm('Close without downloading every file? The recording is only kept here.')
    ) {
      return;
    }
    discardRecording();
  };

  return (
    <div className={styles.backdrop} data-hud>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recording-title"
        data-testid="recording-result"
      >
        <h2 id="recording-title" className={styles.title}>
          Recording ready <span className={styles.length}>{clockText(length)}</span>
        </h2>
        <p className={styles.hint}>
          Download the files you want. They are kept only in this window until you close this.
          Videos are MP4; sounds are{' '}
          {links.some((link) => link.extension === 'ogg') ? 'OGG' : 'M4A'}: both open in Canva.
        </p>
        <ul className={styles.files}>
          {links.map((link) => (
            <li key={link.kind}>
              <a
                className={styles.file}
                href={link.url}
                download={nameOf(link)}
                data-testid={`recording-${link.kind}`}
                data-saved={saved.includes(link.kind) || undefined}
                onClick={() =>
                  setSaved((done) => (done.includes(link.kind) ? done : [...done, link.kind]))
                }
              >
                <span className={styles.name}>{LABEL[link.kind]}</span>
                <span className={styles.meta}>
                  .{link.extension} · {size(link.blob.size)}
                  {saved.includes(link.kind) ? ' · downloaded' : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
        {error ? <p className={styles.hint}>{error}</p> : null}
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.all}
            disabled={allRunning}
            data-testid="recording-all"
            onClick={() => void downloadAll()}
          >
            Download all ({links.length})
          </button>
          <button
            type="button"
            className={styles.close}
            data-testid="recording-close"
            onClick={close}
          >
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
