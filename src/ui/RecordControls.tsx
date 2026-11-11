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
  clockText,
  pauseRecording,
  recordedMs,
  resumeRecording,
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

      <span className={styles.actions}>
        {busy ? (
          <>
            <span className={styles.live} data-state={recorder.state} data-testid="record-time">
              {recorder.state === 'recording' ? '● ' : '❚❚ '}
              {clockText(recordedMs(recorder))}
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
