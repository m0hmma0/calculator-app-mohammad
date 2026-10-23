import { useEffect, useRef, useState } from 'react';
import { importFile, IMPORT_ACCEPT, startImportBatch, useImport } from '@/importers/importFile';
import { insertTable, STAMPS } from '@/input/insertions';
import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore, type Tool } from '@/state/boardStore';
import {
  formatDuration,
  rememberTimer,
  toggleMinimap,
  toggleSound,
  useUiPrefs,
} from '@/state/uiPrefs';
import { celebrate, EFFECTS } from '@/fun/effects';
import { startPresentation } from '@/workshop/presentation';
import {
  clearVote,
  endVote,
  startTimer,
  startVote,
  stopTimer,
  useWorkshop,
} from '@/workshop/workshop';
import { ToolIcon } from './ToolIcon';
import { toolSpec } from './toolSpecs';
import styles from './InsertMenu.module.css';

const SHAPES: Tool[] = [
  'rect',
  'ellipse',
  'triangle',
  'diamond',
  'star',
  'polygon',
  'cloud',
  'spike',
  'line',
  'arrow',
];
const CONTENT: Tool[] = ['sticky', 'text', 'frame'];
/** Tools picked from this menu; while one is in hand, the menu's button says so. */
const MENU_TOOLS = new Set<Tool>([...SHAPES, ...CONTENT, 'stamp']);
const VOTE_BUDGET = 3;
const MAX_TIMER_SECONDS = 99 * 60 + 59;

/**
 * Everything that puts something on the board — shapes, notes, text, frames, tables,
 * stamps, files — and the workshop's tools: presenting, the timer, dot voting. Picking
 * a shape or a note takes up its tool, exactly as its key does.
 */
export function InsertMenu() {
  const editable = useBoardAccess(selectCanEdit);
  const tool = useBoardStore((state) => state.tool);
  const stamp = useBoardStore((state) => state.stamp);
  const setTool = useBoardStore((state) => state.setTool);
  const setStamp = useBoardStore((state) => state.setStamp);
  const minimap = useUiPrefs((state) => state.minimap);
  const sound = useUiPrefs((state) => state.sound);
  const recentTimers = useUiPrefs((state) => state.recentTimers);
  const timer = useWorkshop((state) => state.timer);
  const vote = useWorkshop((state) => state.vote);
  const importStatus = useImport((state) => state.status);
  const importError = useImport((state) => state.error);

  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(() =>
    String(Math.floor((useUiPrefs.getState().recentTimers[0] ?? 300) / 60)),
  );
  const [seconds, setSeconds] = useState(() =>
    String((useUiPrefs.getState().recentTimers[0] ?? 300) % 60),
  );
  const ref = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    action();
    setOpen(false);
  };

  const runTimer = (total: number) => {
    if (!(total > 0)) return;
    startTimer(total);
    rememberTimer(total);
    setOpen(false);
  };
  const typedSeconds = Math.min(
    MAX_TIMER_SECONDS,
    (Number(minutes) || 0) * 60 + (Number(seconds) || 0),
  );

  const active = MENU_TOOLS.has(tool);

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={`${styles.trigger} ${styles.insert}`}
        aria-expanded={open}
        aria-haspopup="menu"
        data-active={active || undefined}
        data-testid="insert-menu"
        onClick={() => {
          setNotice(null);
          setOpen((current) => !current);
        }}
      >
        {active ? (
          <span className={styles.current} aria-hidden="true">
            {tool === 'stamp' ? stamp : <ToolIcon id={tool} size={13} />}
          </span>
        ) : null}
        Insert
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        data-testid="import-file"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          void (async () => {
            startImportBatch();
            for (const file of files) await importFile(file);
            startImportBatch();
          })();
        }}
      />
      {importStatus || importError ? (
        <span
          className={styles.status}
          data-error={importError ? true : undefined}
          role="status"
          data-testid="import-status"
        >
          {importStatus ?? importError}
          {importError ? (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => useImport.setState({ error: null })}
            >
              ×
            </button>
          ) : null}
        </span>
      ) : null}

      {open ? (
        <div className={styles.menu} role="menu" data-testid="insert-panel">
          {editable ? (
            <>
              <p className={styles.label}>Shapes</p>
              <div className={styles.grid}>
                {SHAPES.map((id) => {
                  const spec = toolSpec(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={tool === id}
                      aria-label={spec.shortcut ? `${spec.label} (${spec.shortcut})` : spec.label}
                      title={spec.shortcut ? `${spec.label} — ${spec.shortcut}` : spec.label}
                      data-testid={`insert-tool-${id}`}
                      onClick={run(() => setTool(id))}
                    >
                      <ToolIcon id={id} size={17} />
                    </button>
                  );
                })}
              </div>

              {CONTENT.map((id) => {
                const spec = toolSpec(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tool === id}
                    className={id === 'text' ? `${styles.item} ${styles.text}` : styles.item}
                    data-testid={`insert-tool-${id}`}
                    onClick={run(() => setTool(id))}
                  >
                    <ToolIcon id={id} />
                    <span>{id === 'text' ? 'ABC Text' : spec.label}</span>
                    <kbd>{spec.shortcut}</kbd>
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                data-testid="insert-table"
                onClick={run(insertTable)}
              >
                <TableIcon />
                <span>Table</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                data-testid="insert-import"
                onClick={() => {
                  fileRef.current?.click();
                  setOpen(false);
                }}
              >
                <ImportIcon />
                <span>Import…</span>
                <small>images, SVG, PDF</small>
              </button>

              <p className={styles.label}>Stamps</p>
              <div className={styles.grid}>
                {STAMPS.map((each) => (
                  <button
                    key={each}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tool === 'stamp' && stamp === each}
                    aria-label={`Stamp ${each}`}
                    className={styles.stamp}
                    data-testid={`insert-stamp-${each}`}
                    onClick={run(() => setStamp(each))}
                  >
                    {each}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <p className={styles.label}>Workshop</p>
          <button
            type="button"
            role="menuitem"
            className={styles.item}
            data-testid="present-start"
            onClick={() => {
              if (startPresentation()) setOpen(false);
              else setNotice('Add a frame first — each frame is one slide.');
            }}
          >
            <PresentIcon />
            <span>Present frames</span>
          </button>
          {notice ? <p className={styles.hint}>{notice}</p> : null}

          {editable ? (
            <>
              <form
                className={styles.timer}
                onSubmit={(event) => {
                  event.preventDefault();
                  runTimer(typedSeconds);
                }}
              >
                <TimerIcon />
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={minutes}
                  aria-label="Minutes"
                  data-testid="timer-minutes"
                  onChange={(event) => setMinutes(event.target.value)}
                />
                <span aria-hidden="true">min</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  aria-label="Seconds"
                  data-testid="timer-seconds"
                  onChange={(event) => setSeconds(event.target.value)}
                />
                <span aria-hidden="true">s</span>
                <button type="submit" disabled={typedSeconds <= 0} data-testid="timer-start">
                  Start
                </button>
              </form>
              {recentTimers.length > 0 ? (
                <div className={styles.recent} aria-label="Recent timers">
                  {recentTimers.map((total, index) => (
                    <button
                      key={total}
                      type="button"
                      role="menuitem"
                      title={`Start a ${formatDuration(total)} timer`}
                      data-testid={`timer-recent-${index}`}
                      onClick={() => runTimer(total)}
                    >
                      {formatDuration(total)}
                    </button>
                  ))}
                </div>
              ) : null}
              {timer ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  onClick={run(stopTimer)}
                >
                  <span className={styles.spacer} />
                  <span>Stop the timer</span>
                </button>
              ) : null}

              {!vote || !vote.open ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  data-testid="vote-start"
                  onClick={run(() => startVote(VOTE_BUDGET))}
                >
                  <VoteIcon />
                  <span>{vote ? 'Start a new vote' : 'Dot voting'}</span>
                  <small>{VOTE_BUDGET} dots each</small>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  data-testid="vote-end"
                  onClick={run(endVote)}
                >
                  <VoteIcon />
                  <span>End voting</span>
                </button>
              )}
              {vote ? (
                <button
                  type="button"
                  role="menuitem"
                  className={styles.item}
                  data-testid="vote-clear"
                  onClick={run(clearVote)}
                >
                  <span className={styles.spacer} />
                  <span>Clear the dots</span>
                </button>
              ) : null}
            </>
          ) : null}

          {editable ? (
            <>
              <p className={styles.label}>Celebrate</p>
              <div className={styles.grid}>
                {EFFECTS.map((effect) => (
                  <button
                    key={effect.kind}
                    type="button"
                    role="menuitem"
                    className={styles.stamp}
                    aria-label={`${effect.label} for everyone`}
                    title={`${effect.label} — ${effect.key} while presenting`}
                    data-testid={`celebrate-${effect.kind}`}
                    onClick={run(() => celebrate(effect.kind))}
                  >
                    {effect.emoji}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={sound}
                  aria-label={sound ? 'Celebrations make sound' : 'Celebrations are silent'}
                  title={sound ? 'Sound on — click to mute' : 'Sound off — click to turn on'}
                  data-testid="toggle-sound"
                  onClick={toggleSound}
                >
                  {sound ? '🔊' : '🔇'}
                </button>
              </div>
            </>
          ) : null}

          <p className={styles.label}>View</p>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={minimap}
            className={styles.item}
            data-testid="toggle-minimap"
            onClick={run(toggleMinimap)}
          >
            <MinimapIcon />
            <span>{minimap ? 'Hide the minimap' : 'Show the minimap'}</span>
            <kbd>M</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TableIcon = () => (
  <Icon path="M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6.2 3.5v9M9.8 3.5v9" />
);
const ImportIcon = () => <Icon path="M8 2.5v7.5M5 7l3 3 3-3M3 11.5v2h10v-2" />;
const PresentIcon = () => (
  <Icon path="M2.5 3h11v7.5h-11zM8 10.5V13M5.5 13.5h5M7 5.2v3.1l2.6-1.55Z" />
);
const TimerIcon = () => (
  <Icon path="M8 4.2a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8ZM8 6.5v2.6l1.6 1M6.4 2h3.2" />
);
const VoteIcon = () => (
  <Icon path="M5 6.2a1.7 1.7 0 1 1 0 .01M11 6.2a1.7 1.7 0 1 1 0 .01M8 10.7a1.7 1.7 0 1 1 0 .01" />
);
const MinimapIcon = () => <Icon path="M2.5 3.5h11v9h-11zM8.5 8h3.5v3h-3.5z" />;
