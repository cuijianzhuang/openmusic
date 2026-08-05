import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installOpenMusicDebug } from './lib/debugTools';
import { installVisibilitySync } from './lib/visibilitySync';
import { applyPageSeo, fetchSiteSeo } from './lib/seo';
import { ensureSessionBootstrap } from './lib/sessionBootstrap';
import { refreshQualityCapabilities } from './api/music/quality';
import { warmUpSocketSession } from './hooks/useSocket';
import { applyStoredRoomThemeColor } from './lib/roomThemeColor';
import { installGuideUsageTracking } from './lib/userGuide';
import { prefetchLoadingQuote } from './lib/loadingQuote';

applyStoredRoomThemeColor();
installOpenMusicDebug();
installVisibilitySync();
installGuideUsageTracking();
void prefetchLoadingQuote();
void fetchSiteSeo().then(() => applyPageSeo());
applyPageSeo();
void ensureSessionBootstrap().then(() => {
  void refreshQualityCapabilities();
  return warmUpSocketSession();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
