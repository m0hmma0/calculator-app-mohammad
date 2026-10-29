import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore } from '@/state/boardStore';
import { useUiPrefs } from '@/state/uiPrefs';
import { HIGHLIGHTS } from './palettes';
import styles from './ToolOptions.module.css';

const INK_COLORS = [
  'var(--shape-1)',
  'var(--shape-2)',
  'var(--shape-3)',
  'var(--shape-4)',
  'var(--shape-5)',
  'var(--shape-6)',
];

const INK_WIDTHS = [1.5, 3, 6, 12];
const MARKER_WIDTHS = [12, 20, 32];

/**
 * Settings for the tool in hand — only shown when there is something to set. Top
 * centre on a tall screen; down the board's right edge on a wide one.
 */
export function ToolOptions() {
  const tool = useBoardStore((state) => state.tool);
  const inkWidth = useBoardStore((state) => state.inkWidth);
  const inkColor = useBoardStore((state) => state.inkColor);
  const setInk = useBoardStore((state) => state.setInk);
  const markerWidth = useBoardStore((state) => state.markerWidth);
  const markerColor = useBoardStore((state) => state.markerColor);
  const setMarker = useBoardStore((state) => state.setMarker);
  const eraserMode = useBoardStore((state) => state.eraserMode);
  const setEraserMode = useBoardStore((state) => state.setEraserMode);
  // On a wide screen the options stand at the board's right edge, by the controls —
  // or just left of the side panel, when it is open there.
  const paneOpen = useUiPrefs((state) => state.pane);
  const editable = useBoardAccess(selectCanEdit);
  const besidePanel = paneOpen && editable;

  if (tool === 'highlighter') {
    return (
      <div
        className={styles.bar}
        data-hud
        data-beside-panel={besidePanel || undefined}
        data-testid="tool-options"
      >
        <div className={styles.group}>
          {MARKER_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              className={styles.dot}
              aria-pressed={markerWidth === width}
              aria-label={`Highlighter width ${width}`}
              data-testid={`marker-width-${width}`}
              onClick={() => setMarker({ width })}
            >
              <span
                className={styles.stripe}
                style={{ height: Math.round(width / 3), width: 16 }}
              />
            </button>
          ))}
        </div>
        <span className={styles.divider} />
        <div className={styles.group}>
          {HIGHLIGHTS.map(({ value, name }) => (
            <button
              key={value}
              type="button"
              className={styles.swatch}
              style={{ background: value }}
              aria-pressed={markerColor === value}
              aria-label={`Highlighter ${name}`}
              title={name}
              data-testid={`marker-colour-${name.toLowerCase()}`}
              onClick={() => setMarker({ color: value })}
            />
          ))}
        </div>
      </div>
    );
  }

  if (tool !== 'pen' && tool !== 'eraser') return null;

  return (
    <div
      className={styles.bar}
      data-hud
      data-beside-panel={besidePanel || undefined}
      data-testid="tool-options"
    >
      {tool === 'pen' ? (
        <>
          <div className={styles.group}>
            {INK_WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                className={styles.dot}
                aria-pressed={inkWidth === width}
                aria-label={`Pen width ${width}`}
                data-testid={`ink-width-${width}`}
                onClick={() => setInk({ width })}
              >
                <span
                  style={{
                    width: Math.min(18, Math.max(2.5, width)),
                    height: Math.min(18, Math.max(2.5, width)),
                  }}
                />
              </button>
            ))}
          </div>
          <span className={styles.divider} />
          <div className={styles.group}>
            {INK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                style={{ background: color }}
                aria-pressed={inkColor === color}
                aria-label={`Pen colour ${color}`}
                data-testid={`ink-colour-${color}`}
                onClick={() => setInk({ color })}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.group}>
          <button
            type="button"
            className={styles.mode}
            aria-pressed={eraserMode === 'object'}
            data-testid="eraser-object"
            onClick={() => setEraserMode('object')}
          >
            whole object
          </button>
          <button
            type="button"
            className={styles.mode}
            aria-pressed={eraserMode === 'stroke'}
            data-testid="eraser-stroke"
            onClick={() => setEraserMode('stroke')}
          >
            part of a stroke
          </button>
        </div>
      )}
    </div>
  );
}
