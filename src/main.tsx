import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AudienceView } from './pages/AudienceView';
import { RecordingResult } from './ui/RecordingResult';
import { RecoveryNotice } from './ui/RecoveryNotice';
import { audienceChannel } from './workshop/audienceMode';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

// Presenter view's audience window is this app too, showing only the slides.
const audience = audienceChannel();

createRoot(container).render(
  <StrictMode>
    {audience ? (
      <AudienceView channelName={audience} />
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
