import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Clock, Database, KeyRound, Loader2, LogOut, MemoryStick,
  Music, RefreshCw, ShieldCheck, Trash2, Users, Wifi,
} from 'lucide-react';

const TOKEN_KEY = 'om_admin_token';

interface MetingUpstreamStatus {
  url: string;
  style?: string;
  healthy: boolean;
  cooldownRemainingSec: number;
  okCount: number;
  failCount: number;
  lastError: string;
}

interface AdminOverview {
  roomCount: number;
  onlineUsers: number;
  playingRooms: number;
  connectedSockets: number;
  uptimeSec: number;
  memoryRssMb: number;
  redisEnabled: boolean;
  metingUpstreams: MetingUpstreamStatus[];
}

interface AdminRoom {
  id: string;
  name: string;
  userCount: number;
  users: { id: string; nickname: string }[];
  hasPassword: boolean;
  isLocked: boolean;
  isPlaying: boolean;
  currentSong: { name: string; artist: string } | null;
  queueLength: number;
  createdAt: number;
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': token,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) sessionStorage.removeItem(TOKEN_KEY);
    throw new Error((data as { error?: string }).error || `请求失败（${res.status}）`);
  }
  return data as T;
}

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分`;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-netease-muted">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `登录失败（${res.status}）`);
      sessionStorage.setItem(TOKEN_KEY, data.token);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-netease-dark px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <ShieldCheck className="h-5 w-5 text-netease-red" />
          站点管理后台
        </div>
        <p className="mt-1 text-xs text-netease-muted">输入服务端配置的 ADMIN_KEY 登录</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
          <KeyRound className="h-4 w-4 shrink-0 text-netease-muted" />
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="管理密钥"
            autoFocus
            className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
          />
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !key.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          登录
        </button>
      </form>
    </div>
  );
}

export default function Admin() {
  const [loggedIn, setLoggedIn] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setLoggedIn(false);
    setOverview(null);
    setRooms([]);
  }, []);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const [ov, rm] = await Promise.all([
        adminFetch<AdminOverview>('/api/admin/overview'),
        adminFetch<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
      ]);
      setOverview(ov);
      setRooms(rm.rooms);
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
      if (!sessionStorage.getItem(TOKEN_KEY)) setLoggedIn(false);
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [loggedIn, refresh]);

  const dissolveRoom = useCallback(async (room: AdminRoom) => {
    setDeletingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
      setPendingDeleteId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解散失败');
    } finally {
      setDeletingId(null);
    }
  }, [refresh]);

  if (!loggedIn) {
    return <LoginForm onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <div className="min-h-screen bg-netease-dark px-4 py-6 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <ShieldCheck className="h-5 w-5 text-netease-red" />
            站点管理后台
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        {overview && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<Music className="h-3.5 w-3.5" />} label="房间数" value={overview.roomCount} />
            <StatCard icon={<Users className="h-3.5 w-3.5" />} label="在线用户" value={overview.onlineUsers} />
            <StatCard icon={<Activity className="h-3.5 w-3.5" />} label="播放中房间" value={overview.playingRooms} />
            <StatCard icon={<Wifi className="h-3.5 w-3.5" />} label="Socket 连接" value={overview.connectedSockets} />
            <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="运行时长" value={formatUptime(overview.uptimeSec)} />
            <StatCard icon={<MemoryStick className="h-3.5 w-3.5" />} label="内存占用" value={`${overview.memoryRssMb} MB`} />
            <StatCard
              icon={<Database className="h-3.5 w-3.5" />}
              label="房间存储"
              value={overview.redisEnabled ? 'Redis' : '内存'}
            />
          </div>
        )}

        {overview && overview.metingUpstreams.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
              Meting 音源上游（{overview.metingUpstreams.filter((u) => u.healthy).length}/{overview.metingUpstreams.length} 健康）
            </div>
            <div className="divide-y divide-white/5">
              {overview.metingUpstreams.map((up) => (
                <div key={up.url} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${up.healthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {up.url}
                    {up.style === 'chksz' && (
                      <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">chksz</span>
                    )}
                  </span>
                  <span className="text-xs text-netease-muted">
                    成功 {up.okCount} · 失败 {up.failCount}
                    {!up.healthy && ` · 冷却 ${up.cooldownRemainingSec}s`}
                  </span>
                  {up.lastError && (
                    <span className="w-full truncate pl-6 text-[11px] text-red-400/80">{up.lastError}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
            房间列表（{rooms.length}）
          </div>
          {rooms.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-netease-muted">当前没有活跃房间</div>
          ) : (
            <div className="divide-y divide-white/5">
              {rooms.map((room) => (
                <div key={room.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{room.name}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-netease-muted">{room.id}</span>
                      {room.hasPassword && <span className="text-[10px] text-amber-400">密码房</span>}
                      {room.isLocked && <span className="text-[10px] text-red-400">已上锁</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-netease-muted">
                      {room.userCount} 人在线
                      {room.users.length > 0 && ` · ${room.users.map((u) => u.nickname).join('、')}`}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-netease-muted">
                      {room.currentSong
                        ? `${room.isPlaying ? '▶' : '⏸'} ${room.currentSong.name} - ${room.currentSong.artist}`
                        : '未在播放'}
                      {` · 队列 ${room.queueLength}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {pendingDeleteId === room.id ? (
                      <>
                        <button
                          onClick={() => void dissolveRoom(room)}
                          disabled={deletingId === room.id}
                          className="flex items-center gap-1 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {deletingId === room.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                          确认解散
                        </button>
                        <button
                          onClick={() => setPendingDeleteId(null)}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-netease-muted hover:bg-white/5 hover:text-white"
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setPendingDeleteId(room.id)}
                        className="flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        解散
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
