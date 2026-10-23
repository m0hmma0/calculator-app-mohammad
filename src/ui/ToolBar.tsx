import { selectCanEdit, useBoardAccess } from '@/sharing/boardAccess';
import { useBoardStore, VIEWER_TOOLS, type Tool } from '@/state/boardStore';
import { ToolIcon } from './ToolIcon';
import { toolSpec } from './toolSpecs';
import styles from './ToolBar.module.css';

/**
 * The tools used all the time. Everything that puts something new on the board —
 * shapes, notes, text, frames — lives in the Insert menu instead.
 */
const BAR_TOOLS: Tool[] = ['select', 'hand', 'pen', 'eraser', 'laser'];

export function ToolBar() {
  const tool = useBoardStore((state) => state.tool);
  const setTool = useBoardStore((state) => state.setTool);
  const editable = useBoardAccess(selectCanEdit);
  // Viewers keep the tools that change nothing: looking around, and pointing.
  const tools = editable ? BAR_TOOLS : BAR_TOOLS.filter((id) => VIEWER_TOOLS.has(id));

  return (
    <div className={styles.wrap}>
      {editable ? <UndoRedo /> : null}
      <div className={styles.tools} role="toolbar" aria-label="Tools">
        {tools.map((id) => {
          const spec = toolSpec(id);
          return (
            <button
              key={id}
              type="button"
              className={styles.tool}
              aria-pressed={tool === id}
              aria-label={spec.shortcut ? `${spec.label} (${spec.shortcut})` : spec.label}
              title={spec.shortcut ? `${spec.label} — ${spec.shortcut}` : spec.label}
              onClick={() => setTool(id)}
              data-testid={`tool-${id}`}
            >
              <ToolIcon id={id} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Undo and redo within reach, for anyone who does not know the keys or has none. */
function UndoRedo() {
  const canUndo = useBoardStore((state) => state.canUndo);
  const canRedo = useBoardStore((state) => state.canRedo);
  const undo = useBoardStore((state) => state.undo);
  const redo = useBoardStore((state) => state.redo);
  return (
    <div className={styles.tools} role="group" aria-label="History">
      <button
        type="button"
        className={styles.tool}
        disabled={!canUndo}
        aria-label="Undo (Ctrl+Z)"
        title="Undo — Ctrl/⌘ Z"
        data-testid="undo"
        onClick={undo}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M5.5 3.5 2.5 6.5l3 3M2.8 6.5h6.7a3.5 3.5 0 0 1 0 7H7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={styles.tool}
        disabled={!canRedo}
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo — Ctrl/⌘ Shift Z"
        data-testid="redo"
        onClick={redo}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M10.5 3.5l3 3-3 3M13.2 6.5H6.5a3.5 3.5 0 0 0 0 7H9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
