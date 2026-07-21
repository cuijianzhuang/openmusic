import { Suspense, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import AppUpdateGate from './components/AppUpdateGate';
import ErrorReportSolutionGate from './components/ErrorReportSolutionGate';
import { rememberAdminEntryPath } from './lib/adminEntryShortcut';
import { lazyWithRetry } from './lib/lazyWithRetry';

const Home = lazyWithRetry(() => import('./pages/Home'), 'Home');
const Room = lazyWithRetry(() => import('./pages/Room'), 'Room');
const TvDisplay = lazyWithRetry(() => import('./pages/TvDisplay'), 'TvDisplay');
const Admin = lazyWithRetry(() => import('./pages/Admin'), 'Admin');
const Setup = lazyWithRetry(() => import('./pages/Setup'), 'Setup');

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[50vh] items-center justify-center bg-netease-dark text-netease-muted">
      <div className="flex items-center gap-2 text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-netease-muted/30 border-t-netease-red" />
        加载中…
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 bg-netease-dark text-netease-muted">
      <p className="text-sm">页面不存在</p>
      <a href="/" className="text-xs text-netease-red hover:underline">返回首页</a>
    </div>
  );
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

  // 空闲时预热 QQ 表情清单与常用图，避免每次进房才开始拉
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import('./lib/qface').then((mod) => {
        if (!cancelled) mod.ensureQQFacesLoaded();
      });
      // 预热房间页面及沉浸式背景的懒加载 chunk：新建/加入房间是跳转进 Room.tsx 的
      // 第一次，如果这几个 chunk（尤其是带 three.js 的背景）还没取到，会在跳转瞬间
      // 出现黑屏，直到 chunk 加载完成才渲染出内容。这里提前在空闲时取好，命中浏览器缓存。
      void import('./pages/Room');
      void import('./lib/roomVisualPreset').then((mod) => {
        if (cancelled) return;
        void import('./lib/immersiveEntry').then((entry) => {
          if (!cancelled) void entry.preloadImmersiveBackground(mod.readRoomVisualMode());
        });
      });
    };

    const ric = typeof window !== 'undefined'
      ? window.requestIdleCallback?.bind(window)
      : undefined;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (ric) {
      idleId = ric(warm, { timeout: 3500 });
    } else {
      timeoutId = setTimeout(warm, 1200);
    }

    return () => {
      cancelled = true;
      if (idleId != null) window.cancelIdleCallback?.(idleId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  if (setupRequired === null) return <RouteFallback />;

  return (
    <div className="h-full">
      {!setupRequired && <AppUpdateGate />}
      {!setupRequired && <ErrorReportSolutionGate />}
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
    </div>
  );
}
