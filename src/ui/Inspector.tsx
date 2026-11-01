import { FONT_LABELS, type FontKey } from '@/canvas/fonts';
import { LANGUAGES } from '@/model/highlight';
import { selectCanEdit, useBoardAccess, selectIsOwner } from '@/sharing/boardAccess';
import {
  canHoldLabel,
  isTextual,
  type BoardElement,
  type ElementId,
  DEFAULT_HINT,
  isPlaceholder,
} from '@/model/element';
import { listKindOf, toggleList, type ListKind } from '@/text/lists';
import { useTextSelection } from '@/text/selection';
import { selectionAABB } from '@/model/bounds';
import { degreesOf } from '@/model/transform';
import type { DashStyle } from '@/model/element';
import { useHistory } from '@/collab/history';
import { hintPatch } from '@/input/insertions';
import { hasToolOptions, useBoardStore } from '@/state/boardStore';
import { toggleGeometry, togglePane, useUiPrefs } from '@/state/uiPrefs';
import { linkLabel, normaliseLink } from '@/text/marks';
import { LinkField, LinkIcon } from './LinkField';
import { HIGHLIGHTS, TEXT_COLOURS } from './palettes';
import { ToolOptions } from './ToolOptions';
import styles from './Inspector.module.css';

const FILLS = [
  'var(--shape-1)',
  'var(--shape-2)',
  'var(--shape-3)',
  'var(--shape-4)',
  'var(--shape-5)',
  'var(--shape-6)',
];

/** Fills that suit a box of words: paper, a note's yellow, and pale washes. */
const SOFT_FILLS = [
  'var(--surface)',
  'var(--sticky)',
  'var(--wash-yellow)',
  'var(--wash-green)',
  'var(--wash-blue)',
  'var(--wash-pink)',
];

const STROKES = [...FILLS, 'var(--text)'];

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
  const historyOpen = useHistory((state) => state.open);
  const editable = useBoardAccess(selectCanEdit);
  const showLayers = useUiPrefs((state) => state.layers);
  const typing = useTextSelection();
  const open = useUiPrefs((state) => state.pane);
  const tool = useBoardStore((state) => state.tool);
  const renderVersion = useBoardStore((state) => state.renderVersion);

  const selectOnly = useBoardStore((state) => state.selectOnly);
  const resizeTable = useBoardStore((state) => state.resizeTable);
  const applyDiscrete = useBoardStore((state) => state.applyDiscrete);
  const styleSelection = useBoardStore((state) => state.styleSelection);
  const formatSelectionText = useBoardStore((state) => state.formatSelectionText);
  const setSelectionOpacity = useBoardStore((state) => state.setSelectionOpacity);
  const alignSelection = useBoardStore((state) => state.alignSelection);
  const arrangeSelection = useBoardStore((state) => state.arrangeSelection);
  const showGeometry = useUiPrefs((state) => state.geometry);
  const reorderSelection = useBoardStore((state) => state.reorderSelection);
  const toggleLockSelection = useBoardStore((state) => state.toggleLockSelection);
  const owner = useBoardAccess(selectIsOwner);
  const toggleHiddenSelection = useBoardStore((state) => state.toggleHiddenSelection);
  const groupSelection = useBoardStore((state) => state.groupSelection);
  const ungroupSelection = useBoardStore((state) => state.ungroupSelection);
  const deleteSelection = useBoardStore((state) => state.deleteSelection);

  void renderVersion; // element contents change without the array identity changing

  const ids = new Set(selection);
  const selected = elements.filter((element) => ids.has(element.id));
  const first = selected[0];
  const anyLocked = selected.some((element) => element.locked);
  const topLevel = elements.filter((element) => element.parentId === null);
  const box = selected.length > 0 ? selectionAABB(selected) : null;

  // A stress board has thousands of elements; rendering a button for every one of
  // them costs more than the canvas does. Show the top of the stack and a count.
  const visibleLayers = [...topLevel].reverse().slice(0, LAYER_LIMIT);
  const hiddenLayerCount = topLevel.length - visibleLayers.length;

  // The history panel takes this place, and the inspector describes the live board.
  // Nothing to adjust for someone who can only look.
  /**
   * Lists are written into the text as markers, word-processor style. A box from
   * before that, listed by its style, is converted the first time it is touched.
   */
  const listOf = (element: BoardElement) =>
    element.style.list !== 'none' ? element.style.list : listKindOf(element.text ?? '');
  const toggleListOn = (kind: ListKind) => {
    const patches = new Map<ElementId, Partial<BoardElement>>();
    for (const element of selected) {
      if (element.text === undefined) continue;
      const legacy = element.style.list;
      const style = { ...element.style, list: 'none' as const };
      patches.set(
        element.id,
        legacy === kind ? { style } : { style, text: toggleList(element.text, kind) },
      );
    }
    applyDiscrete(patches);
  };

  const typingHere = Boolean(first && typing.id === first.id && typing.toggle);

  // Switched on and off from the controls (and by its ×). On, it appears when there is
  // something to show: what is selected, the settings of the tool in hand, or the
  // object list when that is switched on too.
  if (historyOpen || !editable || !open) return null;
  const toolOptions = hasToolOptions(tool);
  if (!first && !toolOptions && !showLayers) return null;

  return (
    <aside className={styles.panel} data-hud data-present-hide data-testid="inspector">
      <button
        type="button"
        className={styles.close}
        aria-label="Close the panel"
        title="Close the panel"
        data-testid="close-pane"
        onClick={togglePane}
      >
        ×
      </button>
      {toolOptions ? <ToolOptions inPanel /> : null}
      {first ? (
        <>
          <div className={styles.section}>
            <p className={styles.label}>
              {selected.length > 1 ? `${selected.length} selected` : first.type}
            </p>
          </div>

          {first.type === 'table' && first.table && selected.length === 1 ? (
            <div className={styles.section} data-testid="table-controls">
              <p className={styles.label} data-testid="table-size">
                Table · {first.table.rows} × {first.table.cols}
              </p>
              <div className={styles.row}>
                <button
                  type="button"
                  data-testid="table-add-row"
                  onClick={() => resizeTable(first.id, { rows: first.table!.rows + 1 })}
                >
                  + row
                </button>
                <button
                  type="button"
                  data-testid="table-add-col"
                  onClick={() => resizeTable(first.id, { cols: first.table!.cols + 1 })}
                >
                  + column
                </button>
                <button
                  type="button"
                  disabled={first.table.rows < 2}
                  onClick={() => resizeTable(first.id, { rows: first.table!.rows - 1 })}
                >
                  − row
                </button>
                <button
                  type="button"
                  disabled={first.table.cols < 2}
                  onClick={() => resizeTable(first.id, { cols: first.table!.cols - 1 })}
                >
                  − column
                </button>
              </div>
            </div>
          ) : null}

          {first.type === 'code' && selected.length === 1 ? (
            <div className={styles.section}>
              <p className={styles.label}>Code</p>
              <select
                value={first.language ?? 'auto'}
                aria-label="Language"
                data-testid="code-language"
                onChange={(event) =>
                  applyDiscrete(new Map([[first.id, { language: event.target.value }]]))
                }
              >
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language === 'auto' ? 'Detect automatically' : language}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {first.type === 'embed' && first.embed && selected.length === 1 ? (
            <div className={styles.section}>
              <p className={styles.label}>
                {first.embed.kind === 'link'
                  ? 'Link'
                  : first.embed.media === 'audio'
                    ? 'Sound'
                    : 'Video'}
              </p>
              <p className={styles.embedTitle} data-testid="embed-title">
                {first.embed.title ?? first.embed.url}
              </p>
              {/* A file stored on the board has no page to open; anything on the web does. */}
              {webHost(first.embed.url) ? (
                <a
                  className={styles.embedLink}
                  href={first.embed.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open {first.embed.site ?? webHost(first.embed.url)} ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {isTextual(first) || (canHoldLabel(first) && (first.text || typingHere)) ? (
            <div className={styles.section} data-testid="text-controls">
              <p className={styles.label}>Text</p>
              {first.type === 'text' && selected.length === 1 ? (
                <div className={styles.placeholder}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={isPlaceholder(first)}
                      data-testid="placeholder-toggle"
                      onChange={(event) =>
                        applyDiscrete(
                          new Map([
                            [
                              first.id,
                              hintPatch(first, event.target.checked ? DEFAULT_HINT : null),
                            ],
                          ]),
                        )
                      }
                    />
                    Placeholder — anyone can write in it with one click
                  </label>
                  {isPlaceholder(first) ? (
                    <input
                      type="text"
                      className={styles.hintField}
                      value={first.placeholder ?? ''}
                      placeholder={DEFAULT_HINT}
                      aria-label="The hint it shows while empty"
                      data-testid="placeholder-hint"
                      onChange={(event) =>
                        applyDiscrete(new Map([[first.id, hintPatch(first, event.target.value)]]))
                      }
                    />
                  ) : null}
                </div>
              ) : null}
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
                {/* The exact size, which a default set in Settings need not be one of. */}
                <span className={styles.value} data-testid="font-size">
                  {Math.round(first.style.fontSize)}px
                </span>
              </div>
              <div className={styles.buttons}>
                {/* While typing, these format the selected words (or what is typed
                    next); otherwise, the whole box. Pressing one keeps the typing going. */}
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={
                    typingHere ? Boolean(typing.active.bold) : first.style.fontWeight >= 600
                  }
                  data-testid="text-bold"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    typingHere
                      ? typing.toggle?.('bold')
                      : styleSelection({ fontWeight: first.style.fontWeight >= 600 ? 400 : 700 })
                  }
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={typingHere ? Boolean(typing.active.italic) : first.style.italic}
                  data-testid="text-italic"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    typingHere
                      ? typing.toggle?.('italic')
                      : styleSelection({ italic: !first.style.italic })
                  }
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={
                    typingHere ? Boolean(typing.active.underline) : first.style.underline
                  }
                  data-testid="text-underline"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    typingHere
                      ? typing.toggle?.('underline')
                      : styleSelection({ underline: !first.style.underline })
                  }
                >
                  <u>U</u>
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={typingHere ? Boolean(typing.active.strike) : first.style.strike}
                  aria-label="Strikethrough"
                  title="Strikethrough"
                  data-testid="text-strike"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    typingHere
                      ? typing.toggle?.('strike')
                      : styleSelection({ strike: !first.style.strike })
                  }
                >
                  <s>S</s>
                </button>
                {typingHere ? (
                  <button
                    type="button"
                    className={styles.button}
                    aria-pressed={Boolean(typing.link)}
                    aria-label="Link — Ctrl/⌘ K"
                    title="Link the selected words — Ctrl/⌘ K"
                    data-testid="text-link"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => useTextSelection.setState({ linkOpen: !typing.linkOpen })}
                  >
                    <LinkIcon />
                  </button>
                ) : null}
              </div>
              {typingHere && typing.linkOpen ? (
                <LinkField key={typing.link?.url ?? ''} current={typing.link?.url ?? null} />
              ) : null}
              {typingHere && typing.link && normaliseLink(typing.link.url) ? (
                <a
                  className={styles.linkChip}
                  href={normaliseLink(typing.link.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={typing.link.url}
                  data-testid="text-open-link"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  Open {linkLabel(normaliseLink(typing.link.url)!)} ↗
                </a>
              ) : null}
              <p className={styles.subLabel}>Colour</p>
              <div className={styles.swatches}>
                {TEXT_COLOURS.map(({ value, name }) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.swatch}
                    style={{ background: value }}
                    aria-pressed={
                      typingHere
                        ? typing.active.color === value
                        : !first.marks?.some((mark) => mark.color) &&
                          (first.style.textColor ?? 'var(--text)') === value
                    }
                    aria-label={`Text colour ${name}`}
                    title={name}
                    data-testid={`text-colour-${name.toLowerCase()}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      typingHere
                        ? typing.format?.({ color: value })
                        : // The whole box: every word, including any coloured on its own.
                          formatSelectionText({ color: null }, { textColor: value })
                    }
                  />
                ))}
              </div>
              <p className={styles.subLabel}>Highlight</p>
              <div className={styles.swatches}>
                {HIGHLIGHTS.map(({ value, name }) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.swatch}
                    style={{ background: value }}
                    aria-pressed={
                      typingHere
                        ? typing.active.highlight === value
                        : Boolean(first.text) &&
                          first.marks?.length === 1 &&
                          first.marks[0]!.from === 0 &&
                          first.marks[0]!.to === first.text!.length &&
                          first.marks[0]!.highlight === value
                    }
                    aria-label={`Highlight ${name}`}
                    title={name}
                    data-testid={`text-highlight-${name.toLowerCase()}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() =>
                      typingHere
                        ? typing.format?.({ highlight: value })
                        : formatSelectionText({ highlight: value })
                    }
                  />
                ))}
                <button
                  type="button"
                  className={`${styles.swatch} ${styles.none}`}
                  aria-label="No highlight"
                  title="No highlight"
                  data-testid="text-highlight-none"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    typingHere
                      ? typing.format?.({ highlight: null })
                      : formatSelectionText({ highlight: null })
                  }
                />
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
                  aria-pressed={listOf(first) === 'bullet'}
                  data-testid="text-bullet"
                  onClick={() => toggleListOn('bullet')}
                >
                  • list
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={listOf(first) === 'number'}
                  data-testid="text-number"
                  onClick={() => toggleListOn('number')}
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
              {[...FILLS, ...SOFT_FILLS].map((fill) => (
                <button
                  key={fill}
                  type="button"
                  className={styles.swatch}
                  style={{ background: fill }}
                  aria-pressed={first.style.fill === fill}
                  aria-label={`Fill ${fill}`}
                  data-testid={`fill-${fill}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => styleSelection({ fill })}
                />
              ))}
              <button
                type="button"
                className={`${styles.swatch} ${styles.none}`}
                aria-pressed={first.style.fill === null}
                aria-label="No fill"
                data-testid="fill-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => styleSelection({ fill: null })}
              />
            </div>
          </div>

          <div className={styles.section}>
            <p className={styles.label}>Stroke</p>
            <div className={styles.swatches}>
              {STROKES.map((stroke) => (
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
                  onClick={() =>
                    // A dashed outline needs an outline: a shape without one gets one.
                    styleSelection(
                      dash !== 'solid' && !first.style.stroke && first.type !== 'path'
                        ? {
                            dash,
                            stroke: 'var(--text)',
                            strokeWidth: Math.max(2, first.style.strokeWidth),
                          }
                        : { dash },
                    )
                  }
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
                title="Side by side, a little apart, lined up along the top"
                data-testid="arrange-row"
                onClick={() => arrangeSelection('row')}
              >
                in a row ↔
              </button>
              <button
                type="button"
                className={styles.button}
                title="One under another, a little apart, lined up along the left"
                data-testid="arrange-column"
                onClick={() => arrangeSelection('column')}
              >
                in a column ↕
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
              {/* The owner locks; anyone who edits may unlock what is locked. */}
              {owner || anyLocked ? (
                <button
                  type="button"
                  className={styles.button}
                  aria-pressed={anyLocked}
                  data-testid="toggle-lock"
                  title={owner ? 'Locked for everyone but you' : 'Locked by the owner'}
                  onClick={toggleLockSelection}
                >
                  {anyLocked ? 'unlock' : 'lock'}
                </button>
              ) : null}
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
          <details
            className={styles.details}
            open={showGeometry}
            data-testid="geometry"
            onToggle={(event) => {
              if (event.currentTarget.open !== showGeometry) toggleGeometry();
            }}
          >
            <summary>Position and size</summary>
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
          </details>
        </>
      ) : null}

      {showLayers ? (
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
      ) : null}
    </aside>
  );
}

/** The site an address is on, if it is a web address at all. */
function webHost(address: string): string | null {
  try {
    const url = new URL(address);
    return /^https?:$/.test(url.protocol) ? url.hostname : null;
  } catch {
    return null;
  }
}
