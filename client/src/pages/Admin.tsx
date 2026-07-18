import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Clock, Database, KeyRound, Link2, Loader2, LogOut, MemoryStick,
  Music, RefreshCw, ScrollText, ShieldCheck, Trash2, Users, Wifi,
} from 'lucide-react';

interface MetingUpstreamStatus {
  url: string;
  style?: string;
  healthy: boolean;
  cooldownRemainingSec: number;
  okCount: number;
  failCount: number;
  lastError: string;
  lastProbeAgoSec?: number | null;
  lastProbeOk?: boolean | null;
}

interface AdminAuditEntry {
  at: number;
  action: string;
  ip: string;
  roomId?: string;
  name?: string;
  kicked?: number;
  error?: string;
  path?: string;
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
  entryPath?: string;
  auditLog?: AdminAuditEntry[];
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
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `请求失败（${res.status}）`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
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

function formatAuditTime(at: number) {
  try {
    return new Date(at).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return String(at);
  }
}

function formatAuditAction(entry: AdminAuditEntry) {
  switch (entry.action) {
    case 'login_ok':
      return '登录成功';
    case 'login_fail':
      return '登录失败';
    case 'logout':
      return '退出登录';
    case 'set_entry_path':
      return `更新登录地址 ${entry.path || ''}`;
    case 'destroy_room':
      return `解散房间 ${entry.roomId || ''}${entry.name ? `（${entry.name}）` : ''}${
        typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''
      }`;
    case 'destroy_room_fail':
      return `解散失败 ${entry.roomId || ''}${entry.error ? `：${entry.error}` : ''}`;
    default:
      return entry.action;
  }
}

/** 与服务端 createRandomAdminEntryPath 一致：12 字节 base64url */
function createRandomEntryPath() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `/${b64}`;
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
      await adminFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ key: key.trim() }),
      });
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
            autoComplete="current-password"
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
  const navigate = useNavigate();
  // null = 正在用 HttpOnly Cookie 探测会话；不把 token 放进 JS 可读存储
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [entryPathDraft, setEntryPathDraft] = useState('/admin');
  const [savingPath, setSavingPath] = useState(false);
  const [pathHint, setPathHint] = useState('');
  const loadingRef = useRef(false);
  const savedEntryPathRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await adminFetch('/api/admin/session');
        if (!cancelled) setLoggedIn(true);
      } catch {
        if (!cancelled) setLoggedIn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {
      // 即使请求失败也清本地 UI 状态
    }
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
      if (ov.entryPath) {
        // 仅在未编辑草稿时同步，避免轮询刷新冲掉正在改的地址
        setEntryPathDraft((draft) => {
          if (savedEntryPathRef.current === null || draft === savedEntryPathRef.current) {
            savedEntryPathRef.current = ov.entryPath!;
            return ov.entryPath!;
          }
          return draft;
        });
        if (savedEntryPathRef.current === null) savedEntryPathRef.current = ov.entryPath;
      }
      setError('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载失败';
      setError(message);
      const status = err && typeof err === 'object' && 'status' in err
        ? Number((err as { status?: number }).status)
        : 0;
      if (status === 401 || status === 503) setLoggedIn(false);
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

  const randomizeEntryPath = useCallback(() => {
    setEntryPathDraft(createRandomEntryPath());
    setPathHint('已生成随机地址，点击保存后生效');
  }, []);

  const saveEntryPath = useCallback(async () => {
    if (savingPath) return;
    setSavingPath(true);
    setPathHint('');
    try {
      const res = await adminFetch<{ entryPath: string }>('/api/admin/entry-path', {
        method: 'PUT',
        body: JSON.stringify({ path: entryPathDraft.trim() }),
      });
      savedEntryPathRef.current = res.entryPath;
      setEntryPathDraft(res.entryPath);
      setOverview((prev) => (prev ? { ...prev, entryPath: res.entryPath } : prev));
      setPathHint('已保存，请收藏新地址');
      if (window.location.pathname !== res.entryPath) {
        navigate(res.entryPath, { replace: true });
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存登录地址失败');
    } finally {
      setSavingPath(false);
    }
  }, [entryPathDraft, navigate, refresh, savingPath]);

  if (loggedIn === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-netease-dark text-netease-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!loggedIn) {
    return <LoginForm onLoggedIn={() => setLoggedIn(true)} />;
  }

  const auditLog = overview?.auditLog || [];

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
              onClick={() => void logout()}
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

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Link2 className="h-4 w-4 text-netease-muted" />
            登录地址
          </div>
          <div className="space-y-3 px-4 py-3">
            <p className="text-xs text-netease-muted">
              修改后旧地址将无法打开管理页，请务必保存并收藏新链接
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2">
                <span className="shrink-0 select-none pl-1 text-xs text-netease-muted">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                </span>
                <input
                  value={entryPathDraft}
                  onChange={(e) => {
                    setEntryPathDraft(e.target.value);
                    setPathHint('');
                  }}
                  spellCheck={false}
                  placeholder="/admin"
                  className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm text-white outline-none placeholder:text-netease-muted/60"
                />
                <button
                  type="button"
                  onClick={randomizeEntryPath}
                  title="随机生成登录地址"
                  aria-label="随机生成登录地址"
                  className="shrink-0 rounded-lg p-2 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => void saveEntryPath()}
                disabled={savingPath || !entryPathDraft.trim() || entryPathDraft === overview?.entryPath}
                className="rounded-xl bg-netease-red px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {savingPath ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
              </button>
            </div>
            {pathHint && <p className="text-xs text-emerald-400/90">{pathHint}</p>}
            {overview?.entryPath && (
              <p className="break-all font-mono text-[11px] text-netease-muted">
                当前生效：{typeof window !== 'undefined' ? window.location.origin : ''}{overview.entryPath}
              </p>
            )}
          </div>
        </div>

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
                    {typeof up.lastProbeAgoSec === 'number' && ` · 探测 ${up.lastProbeAgoSec}s 前${up.lastProbeOk === false ? '（失败）' : ''}`}
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

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <ScrollText className="h-4 w-4 text-netease-muted" />
            操作审计（{auditLog.length}，进程内最近记录）
          </div>
          {auditLog.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-netease-muted">暂无操作记录</div>
          ) : (
            <div className="divide-y divide-white/5">
              {auditLog.map((entry, idx) => (
                <div key={`${entry.at}-${entry.action}-${idx}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                  <span className="shrink-0 font-mono text-netease-muted">{formatAuditTime(entry.at)}</span>
                  <span className="min-w-0 flex-1 text-white/90">{formatAuditAction(entry)}</span>
                  {entry.ip && <span className="font-mono text-netease-muted">{entry.ip}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
