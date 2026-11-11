import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AudienceView } from './pages/AudienceView';
import { audienceChannel } from './workshop/audienceMode';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

// Presenter view's audience window is this app too, showing only the slides.
const audience = audienceChannel();

createRoot(container).render(
  <StrictMode>{audience ? <AudienceView channelName={audience} /> : <App />}</StrictMode>,
);
