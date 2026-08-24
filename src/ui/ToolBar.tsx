import { useBoardStore, type Tool } from '@/state/boardStore';
import styles from './ToolBar.module.css';

interface ToolSpec {
  id: Tool;
  label: string;
  shortcut?: string;
  path: string;
  filled?: boolean;
}

const TOOLS: ToolSpec[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    path: 'M3.5 2.2 12.4 8l-3.9.9-1.9 3.6-3.1-10.3Z',
    filled: true,
  },
  {
    id: 'hand',
    label: 'Hand',
    shortcut: 'H',
    path: 'M5 7.5V3.9a1.05 1.05 0 0 1 2.1 0v3M7.1 7V2.9a1.05 1.05 0 0 1 2.1 0V7m0-.6a1.05 1.05 0 0 1 2.1 0v1.2m0-.4a1.05 1.05 0 0 1 2.1 0v3c0 2.3-1.7 3.9-4 3.9s-4.4-1.5-4.4-4v-.3l-1.2-2a1 1 0 0 1 1.7-1L5 8.6',
  },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', path: 'M2.5 3.5h11v9h-11z' },
  {
    id: 'ellipse',
    label: 'Ellipse',
    shortcut: 'O',
    path: 'M8 3.2c3 0 5.5 2.1 5.5 4.8S11 12.8 8 12.8 2.5 10.7 2.5 8 5 3.2 8 3.2Z',
  },
  { id: 'triangle', label: 'Triangle', path: 'M8 3 14 13H2Z' },
  { id: 'diamond', label: 'Diamond', path: 'M8 2.5 13.5 8 8 13.5 2.5 8Z' },
  {
    id: 'star',
    label: 'Star',
    path: 'M8 2.4l1.7 3.7 4 .5-3 2.7.8 4L8 11.3l-3.5 2 .8-4-3-2.7 4-.5Z',
  },
  { id: 'polygon', label: 'Polygon', path: 'M8 2.5l5.2 3.8-2 6.2H4.8l-2-6.2Z' },
  { id: 'line', label: 'Line', shortcut: 'L', path: 'M3 13 13 3' },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', path: 'M3 13 13 3M8.4 3h4.6v4.6' },
  {
    id: 'pen',
    label: 'Pen',
    shortcut: 'P',
    path: 'M3 13.2l.7-2.8L11.1 3a1.7 1.7 0 0 1 2.4 2.4l-7.4 7.4-3.1.8Z',
  },
  {
    id: 'eraser',
    label: 'Eraser',
    shortcut: 'E',
    path: 'M6.3 13.5h6.9M2.7 10.6l4.6 4.6 6-6-4.6-4.6Z',
  },
  { id: 'text', label: 'Text', shortcut: 'T', path: 'M3.5 3.6h9M8 3.6v9M6 12.6h4' },
  {
    id: 'sticky',
    label: 'Sticky note',
    shortcut: 'N',
    path: 'M3 3.5h10v6.2l-3.3 3.3H3Zm10 6.2H9.7v3.3',
  },
  {
    id: 'frame',
    label: 'Frame',
    shortcut: 'F',
    path: 'M5.2 2.5v11M10.8 2.5v11M2.5 5.2h11M2.5 10.8h11',
  },
  {
    id: 'laser',
    label: 'Laser pointer',
    shortcut: 'K',
    path: 'M8 2.4v2.4M8 11.2v2.4M2.4 8h2.4M11.2 8h2.4M8 6.2A1.8 1.8 0 1 1 8 9.8a1.8 1.8 0 0 1 0-3.6Z',
  },
];

export function ToolBar() {
  const tool = useBoardStore((state) => state.tool);
  const setTool = useBoardStore((state) => state.setTool);

  return (
    <div className={styles.tools} role="toolbar" aria-label="Tools">
      {TOOLS.map((spec) => (
        <button
          key={spec.id}
          type="button"
          className={styles.tool}
          aria-pressed={tool === spec.id}
          aria-label={spec.shortcut ? `${spec.label} (${spec.shortcut})` : spec.label}
          title={spec.shortcut ? `${spec.label} — ${spec.shortcut}` : spec.label}
          onClick={() => setTool(spec.id)}
          data-testid={`tool-${spec.id}`}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d={spec.path}
              fill={spec.filled ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
