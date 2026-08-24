import { CanvasStage } from '@/ui/CanvasStage';
import { TopBar } from '@/ui/TopBar';

export function App() {
  return (
    <>
      <TopBar boardName="Untitled board" badge="Phase 0" />
      <CanvasStage />
    </>
  );
}
