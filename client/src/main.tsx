import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installOpenMusicDebug } from './lib/debugTools';
import { installVisibilitySync } from './lib/visibilitySync';
import { applyPageSeo, fetchSiteSeo } from './lib/seo';
import { ensureSessionBootstrap } from './lib/sessionBootstrap';
import { warmUpSocketSession } from './hooks/useSocket';
import { applyStoredRoomThemeColor } from './lib/roomThemeColor';
import { installGuideUsageTracking } from './lib/userGuide';

applyStoredRoomThemeColor();
installOpenMusicDebug();
installVisibilitySync();
installGuideUsageTracking();
void fetchSiteSeo().then(() => applyPageSeo());
applyPageSeo();
void ensureSessionBootstrap().then(() => warmUpSocketSession());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
