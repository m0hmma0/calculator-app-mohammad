import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AudienceView } from './pages/AudienceView';
import { RemoteView } from './pages/RemoteView';
import { RecordingResult } from './ui/RecordingResult';
import { RecoveryNotice } from './ui/RecoveryNotice';
import { audienceChannel } from './workshop/audienceMode';
import { remoteParams } from './workshop/remoteMode';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

// Presenter view's audience window is this app too, showing only the slides.
const audience = audienceChannel();
// And a remote control for a presentation: presenter view on another phone or tab.
const remote = remoteParams();

createRoot(container).render(
  <StrictMode>
    {audience ? (
      <AudienceView channelName={audience} />
    ) : remote ? (
      <RemoteView remoteKey={remote.key} boardId={remote.boardId} />
    ) : (
      <>
        <App />
        {/* Recordings, wherever Sabboura is open: a finished one, or one left over. */}
        <RecordingResult />
        <RecoveryNotice />
      </>
    )}
  </StrictMode>,
);
