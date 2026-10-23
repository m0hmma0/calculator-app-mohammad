import type { Tool } from '@/state/boardStore';
import { toolSpec } from './toolSpecs';

/** A tool's icon, as drawn on its button. */
export function ToolIcon({ id, size = 15 }: { id: Tool; size?: number }) {
  const spec = toolSpec(id);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={spec.path}
        fill={spec.filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
