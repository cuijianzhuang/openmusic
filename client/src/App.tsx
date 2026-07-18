import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import AppUpdateGate from './components/AppUpdateGate';

const Home = lazy(() => import('./pages/Home'));
const Room = lazy(() => import('./pages/Room'));
const TvDisplay = lazy(() => import('./pages/TvDisplay'));
const Admin = lazy(() => import('./pages/Admin'));

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

/** 仅当当前 pathname 匹配服务端配置的管理入口时渲染后台 */
function AdminGate() {
  const location = useLocation();
  const [match, setMatch] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = location.pathname;
    // 静态资源 / 带扩展名的路径不当作管理入口
    if (path.includes('.') || path.startsWith('/assets') || path.startsWith('/qface') || path.startsWith('/vendor')) {
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
        if (!cancelled) setMatch(Boolean(data.match));
      } catch {
        if (!cancelled) setMatch(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (match === null) return <RouteFallback />;
  if (!match) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-2 bg-netease-dark text-netease-muted">
        <p className="text-sm">页面不存在</p>
        <a href="/" className="text-xs text-netease-red hover:underline">返回首页</a>
      </div>
    );
  }
  return <Admin />;
}

export default function App() {
  return (
    <div className="h-full">
      <AppUpdateGate />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/tv/:roomId" element={<TvDisplay />} />
          <Route path="*" element={<AdminGate />} />
        </Routes>
      </Suspense>
    </div>
  );
}
