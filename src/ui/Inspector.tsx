import { FONT_LABELS, type FontKey } from '@/canvas/fonts';
import { isTextual } from '@/model/element';
import { selectionAABB } from '@/model/bounds';
import { degreesOf } from '@/model/transform';
import type { DashStyle } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';
import styles from './Inspector.module.css';

const FILLS = [
  'var(--shape-1)',
  'var(--shape-2)',
  'var(--shape-3)',
  'var(--shape-4)',
  'var(--shape-5)',
  'var(--shape-6)',
];

const DASHES: DashStyle[] = ['solid', 'dashed', 'dotted'];

const LAYER_LIMIT = 200;

const FONT_KEYS: FontKey[] = ['sans', 'serif', 'mono'];
const FONT_SIZES = [12, 16, 20, 28, 40, 64];
const ALIGN_OPTIONS = [
  { id: 'start', label: '⇤' },
  { id: 'center', label: '⇹' },
  { id: 'end', label: '⇥' },
] as const;

const ALIGNMENTS = [
  { id: 'left', label: '⇤', title: 'Align left' },
  { id: 'hcentre', label: '⇹', title: 'Align horizontal centres' },
  { id: 'right', label: '⇥', title: 'Align right' },
  { id: 'top', label: '⤒', title: 'Align top' },
  { id: 'vcentre', label: '⇳', title: 'Align vertical centres' },
  { id: 'bottom', label: '⤓', title: 'Align bottom' },
] as const;

export function Inspector() {
  const elements = useBoardStore((state) => state.elements);
  const selection = useBoardStore((state) => state.selection);
  const renderVersion = useBoardStore((state) => state.renderVersion);

  const selectOnly = useBoardStore((state) => state.selectOnly);
  const styleSelection = useBoardStore((state) => state.styleSelection);
  const setSelectionOpacity = useBoardStore((state) => state.setSelectionOpacity);
  const alignSelection = useBoardStore((state) => state.alignSelection);
  const distributeSelection = useBoardStore((state) => state.distributeSelection);
  const reorderSelection = useBoardStore((state) => state.reorderSelection);
  const toggleLockSelection = useBoardStore((state) => state.toggleLockSelection);
  const toggleHiddenSelection = useBoardStore((state) => state.toggleHiddenSelection);
  const groupSelection = useBoardStore((state) => state.groupSelection);
  const ungroupSelection = useBoardStore((state) => state.ungroupSelection);
  const deleteSelection = useBoardStore((state) => state.deleteSelection);

  void renderVersion; // element contents change without the array identity changing

  const ids = new Set(selection);
  const selected = elements.filter((element) => ids.has(element.id));
  const first = selected[0];
  const topLevel = elements.filter((element) => element.parentId === null);
  const box = selected.length > 0 ? selectionAABB(selected) : null;

  // A stress board has thousands of elements; rendering a button for every one of
  // them costs more than the canvas does. Show the top of the stack and a count.
  const visibleLayers = [...topLevel].reverse().slice(0, LAYER_LIMIT);
  const hiddenLayerCount = topLevel.length - visibleLayers.length;

  return (
    <aside className={styles.panel} data-hud data-testid="inspector">
      {first ? (
        <>
          <div className={styles.section}>
            <p className={styles.label}>
              {selected.length > 1 ? `${selected.length} selected` : first.type}
            </p>
            <dl className={styles.geometry}>
              <dt>X</dt>
              <dd data-testid="geo-x">{Math.round(box?.x ?? 0)}</dd>
              <dt>Y</dt>
              <dd data-testid="geo-y">{Math.round(box?.y ?? 0)}</dd>
              <dt>W</dt>
              <dd data-testid="geo-w">{Math.round(box?.w ?? 0)}</dd>
              <dt>H</dt>
              <dd data-testid="geo-h">{Math.round(box?.h ?? 0)}</dd>
              <dt>∠</dt>
              <dd data-testid="geo-angle">{degreesOf(first.rotation)}°</dd>
            </dl>
          </div>

          {isTextual(first) ? (
            <div className={styles.section} data-testid="text-controls">
              <p className={styles.label}>Text</p>
              <div className={styles.buttons}>
                {FONT_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={styles.button}
                    aria-pressed={first.style.fontFamily === key}
                    data-testid={`font-${key}`}
                    onClick={() => styleSelection({ fontFamily: key })}
                  >
                    {FONT_LABELS[key]}
                  </button>
                ))}
              </div>
              <div className={styles.buttons}>
                {FONT_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={styles.button}
                    aria-pressed={first.style.fontSize === size}
                    data-testid={`size-${size}`}
                    onClick={() => styleSelection({ fontSize: size })}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.fontWeight >= 600}
                  data-testid="text-bold"
                  onClick={() =>
                    styleSelection({ fontWeight: first.style.fontWeight >= 600 ? 400 : 700 })
                  }
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.italic}
                  data-testid="text-italic"
                  onClick={() => styleSelection({ italic: !first.style.italic })}
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.underline}
                  data-testid="text-underline"
                  onClick={() => styleSelection({ underline: !first.style.underline })}
                >
                  <u>U</u>
                </button>
              </div>
              <div className={styles.buttons}>
                {ALIGN_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={styles.button}
                    aria-pressed={first.style.align === option.id}
                    data-testid={`text-align-${option.id}`}
                    onClick={() => styleSelection({ align: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.list === 'bullet'}
                  data-testid="text-bullet"
                  onClick={() =>
                    styleSelection({ list: first.style.list === 'bullet' ? 'none' : 'bullet' })
                  }
                >
                  • list
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.list === 'number'}
                  data-testid="text-number"
                  onClick={() =>
                    styleSelection({ list: first.style.list === 'number' ? 'none' : 'number' })
                  }
                >
                  1. list
                </button>
              </div>
              <div className={styles.row}>
                <input
                  type="range"
                  min={1}
                  max={2.4}
                  step={0.05}
                  value={first.style.lineHeight}
                  aria-label="Line height"
                  data-testid="line-height"
                  onChange={(event) => styleSelection({ lineHeight: Number(event.target.value) })}
                />
                <span className={styles.value}>{first.style.lineHeight.toFixed(2)}</span>
              </div>
              <div className={styles.row}>
                <input
                  type="range"
                  min={-2}
                  max={12}
                  step={0.5}
                  value={first.style.letterSpacing}
                  aria-label="Letter spacing"
                  data-testid="letter-spacing"
                  onChange={(event) =>
                    styleSelection({ letterSpacing: Number(event.target.value) })
                  }
                />
                <span className={styles.value}>{first.style.letterSpacing}</span>
              </div>
            </div>
          ) : null}

          <div className={styles.section}>
            <p className={styles.label}>Fill</p>
            <div className={styles.swatches}>
              {FILLS.map((fill) => (
                <button
                  key={fill}
                  type="button"
                  className={styles.swatch}
                  style={{ background: fill }}
                  aria-pressed={first.style.fill === fill}
                  aria-label={`Fill ${fill}`}
                  onClick={() => styleSelection({ fill })}
                />
              ))}
              <button
                type="button"
                className={`${styles.swatch} ${styles.none}`}
                aria-pressed={first.style.fill === null}
                aria-label="No fill"
                onClick={() => styleSelection({ fill: null })}
              />
            </div>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Stroke</p>
            <div className={styles.swatches}>
              {FILLS.map((stroke) => (
                <button
                  key={stroke}
                  type="button"
                  className={styles.swatch}
                  style={{ background: stroke }}
                  aria-pressed={first.style.stroke === stroke}
                  aria-label={`Stroke ${stroke}`}
                  onClick={() => styleSelection({ stroke })}
                />
              ))}
              <button
                type="button"
                className={`${styles.swatch} ${styles.none}`}
                aria-pressed={first.style.stroke === null}
                aria-label="No stroke"
                onClick={() => styleSelection({ stroke: null })}
              />
            </div>
            <div className={styles.row}>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={first.style.strokeWidth}
                aria-label="Stroke width"
                data-testid="stroke-width"
                onChange={(event) => styleSelection({ strokeWidth: Number(event.target.value) })}
              />
              <span className={styles.value}>{first.style.strokeWidth}</span>
            </div>
            <div className={styles.buttons}>
              {DASHES.map((dash) => (
                <button
                  key={dash}
                  type="button"
                  className={styles.button}
                  aria-pressed={first.style.dash === dash}
                  data-testid={`dash-${dash}`}
                  onClick={() => styleSelection({ dash })}
                >
                  {dash}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Shape</p>
            <div className={styles.row}>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={first.style.radius}
                aria-label="Corner radius"
                data-testid="corner-radius"
                onChange={(event) => styleSelection({ radius: Number(event.target.value) })}
              />
              <span className={styles.value}>{first.style.radius}</span>
            </div>
            <div className={styles.row}>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={first.opacity}
                aria-label="Opacity"
                data-testid="opacity"
                onChange={(event) => setSelectionOpacity(Number(event.target.value))}
              />
              <span className={styles.value}>{Math.round(first.opacity * 100)}%</span>
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                aria-pressed={first.style.shadow}
                onClick={() => styleSelection({ shadow: !first.style.shadow })}
              >
                shadow
              </button>
            </div>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Arrange</p>
            <div className={styles.buttons}>
              {ALIGNMENTS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.button}
                  title={item.title}
                  aria-label={item.title}
                  data-testid={`align-${item.id}`}
                  onClick={() => alignSelection(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                data-testid="distribute-x"
                onClick={() => distributeSelection('x')}
              >
                distribute ↔
              </button>
              <button
                type="button"
                className={styles.button}
                data-testid="distribute-y"
                onClick={() => distributeSelection('y')}
              >
                distribute ↕
              </button>
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                onClick={() => reorderSelection('backward')}
              >
                back ⌄
              </button>
              <button
                type="button"
                className={styles.button}
                onClick={() => reorderSelection('forward')}
              >
                front ⌃
              </button>
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                aria-pressed={first.locked}
                data-testid="toggle-lock"
                onClick={toggleLockSelection}
              >
                {first.locked ? 'unlock' : 'lock'}
              </button>
              <button
                type="button"
                className={styles.button}
                aria-pressed={first.hidden}
                onClick={toggleHiddenSelection}
              >
                {first.hidden ? 'show' : 'hide'}
              </button>
            </div>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.button}
                data-testid="group"
                onClick={groupSelection}
              >
                group
              </button>
              <button
                type="button"
                className={styles.button}
                data-testid="ungroup"
                onClick={ungroupSelection}
              >
                ungroup
              </button>
              <button type="button" className={styles.button} onClick={deleteSelection}>
                delete
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className={styles.hint}>Nothing selected. Draw a shape, or drag a box to select.</p>
      )}

      <ul className={styles.layers} data-testid="layers">
        {visibleLayers.map((element) => (
          <li key={element.id}>
            <button
              type="button"
              className={styles.layer}
              aria-selected={ids.has(element.id)}
              data-testid={`layer-${element.id}`}
              onClick={() => selectOnly([element.id])}
            >
              <span className={styles.layerName}>{element.type}</span>
              {element.locked ? (
                <span className={styles.badge} title="Locked" data-testid="layer-locked">
                  🔒
                </span>
              ) : null}
              {element.hidden ? (
                <span className={styles.badge} title="Hidden">
                  ◌
                </span>
              ) : null}
            </button>
          </li>
        ))}
        {hiddenLayerCount > 0 ? (
          <li className={styles.more}>and {hiddenLayerCount.toLocaleString()} more</li>
        ) : null}
      </ul>
    </aside>
  );
}
