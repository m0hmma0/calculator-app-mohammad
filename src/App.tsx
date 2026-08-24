import { useShortcuts } from '@/input/useShortcuts';
import { CanvasStage } from '@/ui/CanvasStage';
import { TopBar } from '@/ui/TopBar';

export function App() {
  useShortcuts();

  return (
    <>
      <TopBar boardName="Untitled board" badge="Phase 1" />
      <CanvasStage />
    </>
  );
}
