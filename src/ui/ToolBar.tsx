import { useBoardStore, type Tool } from '@/state/boardStore';
import styles from './ToolBar.module.css';

interface ToolSpec {
  id: Tool;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}

const TOOLS: ToolSpec[] = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3.5 2.2 12.4 8l-3.9.9-1.9 3.6-3.1-10.3Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: 'hand',
    label: 'Hand',
    shortcut: 'H',
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5 7.5V3.9a1.05 1.05 0 0 1 2.1 0v3M7.1 7V2.9a1.05 1.05 0 0 1 2.1 0V7m0-.6a1.05 1.05 0 0 1 2.1 0v1.2m0-.4a1.05 1.05 0 0 1 2.1 0v3c0 2.3-1.7 3.9-4 3.9s-4.4-1.5-4.4-4v-.3l-1.2-2a1 1 0 0 1 1.7-1L5 8.6"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
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
          aria-label={`${spec.label} (${spec.shortcut})`}
          title={`${spec.label} — ${spec.shortcut}`}
          onClick={() => setTool(spec.id)}
          data-testid={`tool-${spec.id}`}
        >
          {spec.icon}
        </button>
      ))}
    </div>
  );
}
