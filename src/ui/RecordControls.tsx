import { useEffect, useState } from 'react';
import {
  CAMERA_SHAPES,
  setCameraLayout,
  setCameraOn,
  setMicOn,
  useCamera,
  type CameraShape,
} from '@/recording/camera';
import {
  allowRecordingFolder,
  chooseRecordingFolder,
  folderPickerAvailable,
  forgetRecordingFolder,
  useRecordingFolder,
} from '@/recording/folder';
import { recordingSpace } from '@/recording/recovery';
import {
  clockText,
  pauseRecording,
  recordedMs,
  resumeRecording,
  setResolution,
  startRecording,
  stopRecording,
  useRecorder,
} from '@/recording/recorder';
import styles from './RecordControls.module.css';

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * Presenter view's recording row: the camera, the microphone and the slides' own
 * sound, each on or off; the camera's shape; and Record, which records the audience
 * window. While recording: the time, Pause and Stop.
 */
export function RecordControls() {
  const stream = useCamera((state) => state.stream);
  const mic = useCamera((state) => state.mic);
  const slideSound = useCamera((state) => state.slideSound);
  const shape = useCamera((state) => state.layout.shape);
  const problem = useCamera((state) => state.problem);
  const recorder = useRecorder();
  const busy = recorder.state === 'recording' || recorder.state === 'paused';
  const [, tick] = useState(0);

  useEffect(() => {
    if (recorder.state !== 'recording') return;
    const timer = setInterval(() => tick((count) => count + 1), 250);
    return () => clearInterval(timer);
  }, [recorder.state]);

  return (
    <div className={styles.row} role="group" aria-label="Recording">
      <Switch
        label="Camera"
        on={stream !== null}
        testId="record-camera"
        onChange={(on) => void setCameraOn(on)}
      />
      {stream ? (
        <span className={styles.shapes} role="radiogroup" aria-label="Camera shape">
          {CAMERA_SHAPES.map((each) => (
            <button
              key={each.shape}
              type="button"
              role="radio"
              aria-checked={shape === each.shape}
              aria-label={each.label}
              title={each.label}
              className={styles.shape}
              data-testid={`camera-shape-${each.shape}`}
              onMouseDown={keepFocus}
              onClick={() => setCameraLayout({ shape: each.shape })}
            >
              <ShapeIcon shape={each.shape} />
            </button>
          ))}
        </span>
      ) : null}
      <Switch
        label="Microphone"
        on={mic !== null}
        testId="record-mic"
        onChange={(on) => void setMicOn(on)}
      />
      <Switch
        label="Slides’ sound"
        title="Record the sound of videos, sounds and celebrations on the slides"
        on={slideSound}
        disabled={busy}
        testId="record-slide-sound"
        onChange={(on) => useCamera.setState({ slideSound: on })}
      />

      <label className={styles.size}>
        <span className={styles.sizeLabel}>Size</span>
        <select
          value={recorder.resolution}
          disabled={busy || recorder.state === 'starting'}
          aria-label="Recording size"
          data-testid="record-resolution"
          onChange={(event) => setResolution(event.target.value === '720' ? 720 : 1080)}
        >
          <option value={1080}>1080p</option>
          <option value={720}>720p</option>
        </select>
      </label>

      <span className={styles.actions}>
        {busy ? (
          <>
            <span className={styles.live} data-state={recorder.state} data-testid="record-time">
              {recorder.state === 'recording' ? '● ' : '❚❚ '}
              {clockText(recordedMs(recorder))}
            </span>
            <span
              className={styles.stored}
              title="Written to this computer's disk: kept even if the browser or computer stops"
              data-testid="record-stored"
              data-seconds={Math.floor(recorder.stored)}
            >
              safe on disk {clockText(recorder.stored * 1000)}
            </span>
            {recorder.state === 'recording' ? (
              <button
                type="button"
                className={styles.button}
                data-testid="record-pause"
                onMouseDown={keepFocus}
                onClick={pauseRecording}
              >
                Pause
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                data-testid="record-resume"
                onMouseDown={keepFocus}
                onClick={resumeRecording}
              >
                Resume
              </button>
            )}
            <button
              type="button"
              className={styles.button}
              data-testid="record-stop"
              onMouseDown={keepFocus}
              onClick={() => void stopRecording()}
            >
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`${styles.button} ${styles.record}`}
            disabled={recorder.state === 'starting' || recorder.state === 'finishing'}
            title="Record the audience window: choose the tab ending “— slides” when the browser asks"
            data-testid="record-start"
            onMouseDown={keepFocus}
            onClick={() => void startRecording()}
          >
            {recorder.state === 'finishing' ? 'Saving…' : '● Record'}
          </button>
        )}
      </span>
      <FolderChoice disabled={busy} />
      {busy ? <Sharpness /> : <Room />}
      {problem || recorder.error ? (
        <span className={styles.problem} role="alert" data-testid="record-problem">
          {problem ?? recorder.error}
        </span>
      ) : null}
    </div>
  );
}

function Switch({
  label,
  title,
  on,
  disabled,
  testId,
  onChange,
}: {
  label: string;
  title?: string;
  on: boolean;
  disabled?: boolean;
  testId: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={styles.switch}
      title={title}
      disabled={disabled}
      data-testid={testId}
      onMouseDown={keepFocus}
      onClick={() => onChange(!on)}
    >
      <span className={styles.knob} aria-hidden="true" />
      {label}
    </button>
  );
}

function ShapeIcon({ shape }: { shape: CameraShape }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      {shape === 'circle' ? (
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      ) : shape === 'square' ? (
        <rect
          x="3"
          y="3"
          width="14"
          height="14"
          rx="3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      ) : (
        <rect
          x="1.5"
          y="5"
          width="17"
          height="10"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      )}
    </svg>
  );
}

/**
 * The recorded window's own size against the file's. A browser records a tab at the
 * size it is on screen, so a small audience window makes a soft video: say so, and how
 * to fix it.
 */
function Sharpness() {
  const source = useRecorder((state) => state.source);
  const resolution = useRecorder((state) => state.resolution);
  if (!source) return null;
  const target = resolution === 1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const soft = scale > 1.05;
  return (
    <span className={soft ? styles.soft : styles.sharp} data-testid="record-source">
      Recording {target.width}×{target.height} from a {source.width}×{source.height} window
      {soft
        ? ' — make the audience window full screen (double-click it) for a sharper picture.'
        : '.'}
    </span>
  );
}

/**
 * Where finished recordings go by themselves: a folder on this computer (Chrome, Edge).
 * Without one, they are downloaded from the dialog at the end.
 */
function FolderChoice({ disabled }: { disabled: boolean }) {
  const handle = useRecordingFolder((state) => state.handle);
  const allowed = useRecordingFolder((state) => state.allowed);
  if (!folderPickerAvailable()) return null;
  return (
    <span className={styles.folder} data-testid="record-folder">
      {handle ? (
        <>
          <span className={styles.sizeLabel}>Save to</span>
          <strong title="Finished recordings are saved here by themselves">📁 {handle.name}</strong>
          {!allowed ? (
            <button
              type="button"
              className={styles.button}
              data-testid="record-folder-allow"
              onMouseDown={keepFocus}
              onClick={() => void allowRecordingFolder()}
            >
              Allow
            </button>
          ) : null}
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            data-testid="record-folder-change"
            onMouseDown={keepFocus}
            onClick={() => void chooseRecordingFolder()}
          >
            Change
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={disabled}
            aria-label="Stop saving to this folder"
            title="Stop saving to this folder"
            data-testid="record-folder-forget"
            onMouseDown={keepFocus}
            onClick={() => void forgetRecordingFolder()}
          >
            ×
          </button>
        </>
      ) : (
        <button
          type="button"
          className={styles.button}
          disabled={disabled}
          title="Finished recordings are saved there by themselves, no download needed"
          data-testid="record-folder-choose"
          onMouseDown={keepFocus}
          onClick={() => void chooseRecordingFolder()}
        >
          📁 Save to a folder…
        </button>
      )}
    </span>
  );
}

const gigabytes = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1)} GB`
    : `${Math.round(bytes / 1e6)} MB`;

/**
 * The room this computer has for recordings: they are written to its disk as they are
 * made. Short of room, in amber, with roughly how long that is.
 */
function Room() {
  const space = useRecorder((state) => state.space);
  const resolution = useRecorder((state) => state.resolution);
  useEffect(() => {
    void recordingSpace().then((found) => useRecorder.setState({ space: found }));
  }, []);
  if (!space) return null;
  // At most about 60 MB a minute at 1080p (30 at 720p), all files together; slides that
  // hardly change take far less.
  const perMinute = (resolution === 1080 ? 60 : 30) * 1e6 * 1.4;
  const minutes = Math.floor(space.free / perMinute);
  const short = space.free < 2e9;
  return (
    <span className={short ? styles.soft : styles.sharp} data-testid="record-space">
      Room for recordings on this computer: {gigabytes(space.free)}
      {short ? ` — about ${minutes} minutes at ${resolution}p` : ''}.
    </span>
  );
}
