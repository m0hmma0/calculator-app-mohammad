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
  );
}
