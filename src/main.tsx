import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './errors/ErrorBoundary';
import { installErrorReporting } from './errors/report';
import { AudienceView } from './pages/AudienceView';
import { RemoteView } from './pages/RemoteView';
import { RecordingResult } from './ui/RecordingResult';
import { RecoveryNotice } from './ui/RecoveryNotice';
import { audienceChannel } from './workshop/audienceMode';
import { remoteParams, watchParams } from './workshop/remoteMode';
import './styles/global.css';

installErrorReporting();

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

// Presenter view's audience window is this app too, showing only the slides.
const audience = audienceChannel();
// And a remote control for a presentation: presenter view on another phone or tab.
const remote = remoteParams();
// And the slides alone, from a link: the audience window on any device.
const watch = watchParams();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      {audience ? (
        <AudienceView channelName={audience} />
      ) : watch ? (
        <AudienceView link={watch} />
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
    </ErrorBoundary>
  </StrictMode>,
);
