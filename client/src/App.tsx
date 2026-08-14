import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import AppUpdateGate from './components/AppUpdateGate';
import AppErrorBoundary from './components/AppErrorBoundary';
import ErrorReportSolutionGate from './components/ErrorReportSolutionGate';
import PermanentDecisionGate from './components/PermanentDecisionGate';
import NotFoundPage from './components/NotFoundPage';
import { rememberAdminEntryPath } from './lib/adminEntryShortcut';
import { lazyWithRetry } from './lib/lazyWithRetry';
import { nextLoadingQuote, useLoadingQuote } from './lib/loadingQuote';

const Home = lazyWithRetry(() => import('./pages/Home'), 'Home');
const Room = lazyWithRetry(() => import('./pages/Room'), 'Room');
const TvDisplay = lazyWithRetry(() => import('./pages/TvDisplay'), 'TvDisplay');
const Admin = lazyWithRetry(() => import('./pages/Admin'), 'Admin');
const Setup = lazyWithRetry(() => import('./pages/Setup'), 'Setup');

function RouteFallback() {
  const loadingQuote = useLoadingQuote();
  useEffect(() => {
    nextLoadingQuote();
  }, []);
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-netease-dark text-netease-muted">
      <div className="flex flex-col items-center gap-3 text-center text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-netease-muted/30 border-t-netease-red" />
        {loadingQuote}
      </div>
    </div>
  );
}

function NotFound() {
  return <NotFoundPage />;
}

/** 与服务端 sanitizeAdminEntryPath 对齐：仅合法形态才打 gate，避免 * 通配放大探测 */
function looksLikeAdminEntryPath(pathname: string): boolean {
  if (pathname === '/admin') return true;
  return /^\/[A-Za-z0-9_-]{8,64}$/.test(pathname);
}

/** 仅当当前 pathname 匹配服务端配置的管理入口时渲染后台 */
function AdminGate() {
  const location = useLocation();
  const [match, setMatch] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = location.pathname;

    if (
      path.includes('.')
      || path.startsWith('/assets')
      || path.startsWith('/qface')
      || path.startsWith('/vendor')
      || !looksLikeAdminEntryPath(path)
    ) {
      setMatch(false);
      return;
    }

    setMatch(null);
    (async () => {
      try {
        const res = await fetch('/api/admin/gate', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        const data = await res.json().catch(() => ({}));
        const matched = Boolean(data.match);
        if (!cancelled) {
          setMatch(matched);
          // 只在真正命中管理入口的这台设备本地记住路径，方便下次从首页快捷进入
          if (matched) rememberAdminEntryPath(path);
        }
      } catch {
        if (!cancelled) setMatch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (match === null) return <RouteFallback />;
  if (!match) return <NotFound />;
  return <Admin />;
}

export default function App() {
  const location = useLocation();
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/setup/status', { credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setSetupRequired(Boolean(data.setupRequired));
      })
      .catch(() => {
        // 兼容尚未升级 setup API 的服务端，不阻断正常页面。
        if (!cancelled) setSetupRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (setupRequired === null) return <RouteFallback />;

  return (
    <div className="h-full">
      {!setupRequired && <AppUpdateGate />}
      {!setupRequired && <ErrorReportSolutionGate />}
      {!setupRequired && <PermanentDecisionGate />}
      <AppErrorBoundary key={location.pathname}>
        <Suspense fallback={<RouteFallback />}>
          {setupRequired ? (
            <Setup />
          ) : (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/room/:roomId" element={<Room />} />
              <Route path="/tv/:roomId" element={<TvDisplay />} />
              <Route path="*" element={<AdminGate />} />
            </Routes>
          )}
        </Suspense>
      </AppErrorBoundary>
    </div>
  );
}
