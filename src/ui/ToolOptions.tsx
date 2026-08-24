import { useBoardStore } from '@/state/boardStore';
import styles from './ToolOptions.module.css';

const INK_COLORS = [
  'var(--shape-1)',
  'var(--shape-2)',
  'var(--shape-3)',
  'var(--shape-4)',
  'var(--shape-5)',
  'var(--shape-6)',
];

const INK_WIDTHS = [3, 6, 12, 24];

/** Settings for the tool in hand — only shown when there is something to set. */
export function ToolOptions() {
  const tool = useBoardStore((state) => state.tool);
  const inkWidth = useBoardStore((state) => state.inkWidth);
  const inkColor = useBoardStore((state) => state.inkColor);
  const setInk = useBoardStore((state) => state.setInk);
  const eraserMode = useBoardStore((state) => state.eraserMode);
  const setEraserMode = useBoardStore((state) => state.setEraserMode);

  if (tool !== 'pen' && tool !== 'eraser') return null;

  return (
    <div className={styles.bar} data-hud data-testid="tool-options">
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
                <span style={{ width: Math.min(18, width), height: Math.min(18, width) }} />
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
