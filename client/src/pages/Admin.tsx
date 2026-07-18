import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Ban, Bug, CheckCircle2, ChevronLeft, ChevronRight, Clock, Database, Gauge, KeyRound, Link2, Loader2,
  LogOut, Megaphone, MemoryStick, Music, Plus, Radio, RefreshCw, ScrollText, Settings, ShieldCheck, Trash2, Users, Wifi,
} from 'lucide-react';
import Modal from '../components/Modal';
import { AdminCheckbox, AdminSelect, AdminSwitch } from '../components/FormControls';

interface MetingUpstreamStatus {
  url: string;
  style?: string;
  disabled?: boolean;
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
  enabled?: boolean;
  announcementId?: string;
  url?: string;
  disabled?: boolean;
  roomCount?: number;
  banType?: string;
  value?: string;
  banId?: string;
  reportId?: string;
  status?: string;
  username?: string;
}

interface SiteAnnouncementConfig {
  enabled: boolean;
  id: string;
  title: string;
  text: string;
}

interface RuntimeConfig {
  roomEmptyTtlMs: number;
  metingApiUrl: string;
  metingApiAuth: string;
  metingSources: {
    url: string;
    type: 'meting' | 'chksz';
    configuredAuth: boolean;
    auth?: string;
    clearAuth?: boolean;
  }[];
  cyapiBase: string;
  cyapiKey: string;
  vmyLrcUrl: string;
  qiniuAccessKey: string;
  qiniuSecretKey: string;
  qiniuBucket: string;
  qiniuDomain: string;
  qiniuZone: string;
  apihzBaseUrl: string;
  apihzId: string;
  apihzKey: string;
  configuredSecrets: Record<string, boolean>;
}

interface SiteBanEntry {
  id: string;
  type: 'ip' | 'device';
  value: string;
  reason: string;
  at: number;
}

interface ErrorReportSummary {
  id: string;
  status: 'open' | 'resolved';
  description: string;
  ip: string;
  userId: string;
  createdAt: number;
  resolvedAt: number | null;
  note: string;
  meta: {
    roomId?: string | null;
    nickname?: string | null;
    trackName?: string | null;
    trackSource?: string | null;
    href?: string | null;
  };
  eventCount: number;
  hasSnapshot: boolean;
}

interface ErrorReportDetail extends ErrorReportSummary {
  snapshot: string;
  events: { at: string; name: string; line: string }[];
  meta: Record<string, string | number | boolean | null>;
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
  adminUsername?: string;
  credentialsPersisted?: boolean;
  mustChangeCredentials?: boolean;
  mustChangeEntryPath?: boolean;
  setupRequired?: boolean;
  auditStoredIn?: 'redis' | 'memory';
}

interface AdminRoom {
  id: string;
  name: string;
  userCount: number;
  users: { id: string; nickname: string; clientIp?: string; deviceId?: string }[];
  hasPassword: boolean;
  isLocked: boolean;
  isPlaying: boolean;
  currentSong: { name: string; artist: string } | null;
  queueLength: number;
  createdAt: number;
  protectedFromDestroy: boolean;
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
      return `登录成功${entry.username ? ` ${entry.username}` : ''}`;
    case 'login_fail':
      return `登录失败${entry.username ? ` ${entry.username}` : ''}`;
    case 'logout':
      return '退出登录';
    case 'set_credentials':
      return `修改管理员账号密码${entry.username ? `（${entry.username}）` : ''}`;
    case 'set_entry_path':
      return `更新登录地址 ${entry.path || ''}`;
    case 'set_runtime_config':
      return '更新运行配置';
    case 'set_announcement':
      return `更新站点公告（${entry.enabled ? '启用' : '停用'}）`;
    case 'set_room_protection':
      return `${entry.enabled ? '开启' : '关闭'}房间保活 ${entry.roomId || ''}`;
    case 'meting_reset_cooldown':
      return `重置上游冷却 ${entry.url || ''}`;
    case 'meting_set_disabled':
      return `${entry.disabled ? '禁用' : '启用'}上游 ${entry.url || ''}`;
    case 'broadcast':
      return `全局广播（${entry.roomCount ?? 0} 个房间）`;
    case 'site_ban_add':
      return `封禁 ${entry.banType || ''} ${entry.value || ''}${typeof entry.kicked === 'number' ? ` · 踢出 ${entry.kicked}` : ''}`;
    case 'site_ban_remove':
      return `解除封禁 ${entry.banId || ''}`;
    case 'error_report_update':
      return `处理错误上报 ${entry.reportId || ''}${entry.status ? ` → ${entry.status}` : ''}`;
    case 'error_report_delete':
      return `删除错误上报 ${entry.reportId || ''}`;
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

type AdminTabId = 'overview' | 'rooms' | 'bans' | 'reports' | 'notify' | 'settings' | 'audit';

const ADMIN_TABS: { id: AdminTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: '概览', icon: Gauge },
  { id: 'rooms', label: '房间管理', icon: Music },
  { id: 'bans', label: '全站封禁', icon: Ban },
  { id: 'reports', label: '错误上报', icon: Bug },
  { id: 'notify', label: '公告广播', icon: Megaphone },
  { id: 'settings', label: '系统设置', icon: Settings },
  { id: 'audit', label: '操作审计', icon: ScrollText },
];

const TAB_META: Record<AdminTabId, { title: string; description: string }> = {
  overview: { title: '概览', description: '实时运行状态与音源健康' },
  rooms: { title: '房间管理', description: '查看在线房间，设置保活或解散' },
  bans: { title: '全站封禁', description: '按 IP 或设备封禁，阻止进房和建房' },
  reports: { title: '错误上报', description: '用户提交的问题反馈与调试日志' },
  notify: { title: '公告广播', description: '首页公告与全房间系统通知' },
  settings: { title: '系统设置', description: '登录入口、管理员账号与运行配置，保存后即时生效' },
  audit: { title: '操作审计', description: '管理端全部操作记录，Redis 持久化' },
};

const LIST_PAGE_SIZE = 15;
const AUDIT_PAGE_SIZE = 20;

function useClientPage<T>(items: T[], pageSize = LIST_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, pageSize, safePage]);

  return { page: safePage, setPage, total, totalPages, pageItems, pageSize };
}

function AdminPagination({
  page,
  totalPages,
  total,
  pageSize,
  onChange,
  className = '',
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-4 py-2.5 ${className}`}>
      <p className="text-[11px] text-netease-muted">
        第 {from}–{to} 条，共 {total} 条
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="上一页"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-netease-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-35"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4.5rem] text-center text-xs text-netease-muted">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          aria-label="下一页"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-netease-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-35"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center gap-2 text-xs text-netease-muted">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

/** 设置页分区：左列标题 + 说明，右列表单内容 */
function SettingsSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 py-6 first:pt-5 last:pb-5 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
          {title}
          {badge}
        </h3>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed text-netease-muted">{description}</p>
        )}
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  );
}

function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      await adminFetch('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username: username.trim(), password }),
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
        <p className="mt-1 text-xs text-netease-muted">输入管理员账号密码登录</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
          <Users className="h-4 w-4 shrink-0 text-netease-muted" />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="管理员账号"
            autoFocus
            autoComplete="username"
            spellCheck={false}
            className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
          />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3">
          <KeyRound className="h-4 w-4 shrink-0 text-netease-muted" />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            autoComplete="current-password"
            className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
          />
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          登录
        </button>
      </form>
    </div>
  );
}

function CredentialsPanel({
  adminUsername,
  persisted,
  forced,
  bare,
  onError,
  onSaved,
}: {
  adminUsername: string;
  persisted: boolean;
  forced?: boolean;
  /** 只渲染表单本体，由外层 SettingsSection 提供标题与说明 */
  bare?: boolean;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  const [username, setUsername] = useState(adminUsername);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');
  const touchedRef = useRef(false);

  useEffect(() => {
    if (!touchedRef.current) setUsername(adminUsername);
  }, [adminUsername]);

  const save = async () => {
    if (saving) return;
    if (password !== passwordConfirm) {
      onError('两次输入的新密码不一致');
      return;
    }
    if (password === '123456') {
      onError('不能继续使用默认密码');
      return;
    }
    setSaving(true);
    setHint('');
    try {
      const res = await adminFetch<{ username: string; persisted: boolean }>('/api/admin/credentials', {
        method: 'PUT',
        body: JSON.stringify({ username: username.trim(), password, currentPassword }),
      });
      touchedRef.current = false;
      setPassword('');
      setPasswordConfirm('');
      setCurrentPassword('');
      setHint(`已保存到 Redis（${res.username}），其它已登录会话已失效`);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : '修改账号密码失败');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-netease-muted">账号（2–32 位字母数字或 _ . @ -）</span>
            <input
              value={username}
              onChange={(e) => {
                touchedRef.current = true;
                setUsername(e.target.value);
              }}
              autoComplete="username"
              spellCheck={false}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-netease-muted">当前密码</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-netease-muted">新密码（8–64 位）</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-netease-muted">确认新密码</span>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {hint ? <p className="text-xs text-emerald-400/90">{hint}</p> : <span />}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !username.trim() || password.length < 8 || !currentPassword}
            className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存账号密码'}
          </button>
        </div>
    </>
  );

  if (bare) return <div className="space-y-3">{body}</div>;

  return (
    <div className={`${forced ? '' : 'mt-5'} rounded-2xl border border-white/10 bg-white/5`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
        <KeyRound className="h-4 w-4 text-netease-muted" />
        管理员账号
        {forced && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">必须修改</span>}
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${
          persisted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
        }`}
        >
          {persisted ? 'Redis 持久化' : 'Redis 未就绪'}
        </span>
      </div>
      <div className="space-y-3 px-4 py-3">
        <p className="text-xs text-netease-muted">
          密码以 scrypt 哈希存 Redis（不落盘）；新密码至少 8 位且不能是默认密码；修改后其它会话立即失效
        </p>
        {body}
      </div>
    </div>
  );
}

function InitialSetupGate({
  overview,
  onError,
  onUpdated,
}: {
  overview: AdminOverview;
  onError: (message: string) => void;
  onUpdated: () => void;
}) {
  const navigate = useNavigate();
  const [entryPathDraft, setEntryPathDraft] = useState(() => {
    if (overview.entryPath && overview.entryPath !== '/admin') return overview.entryPath;
    return createRandomEntryPath();
  });
  const [savingPath, setSavingPath] = useState(false);
  const [pathHint, setPathHint] = useState('');

  const saveEntryPath = async () => {
    if (savingPath) return;
    const path = entryPathDraft.trim();
    if (path === '/admin') {
      onError('初始设置须使用非 /admin 的随机路径');
      return;
    }
    setSavingPath(true);
    setPathHint('');
    try {
      const res = await adminFetch<{ entryPath: string }>('/api/admin/entry-path', {
        method: 'PUT',
        body: JSON.stringify({ path }),
      });
      setPathHint('登录地址已保存');
      if (window.location.pathname !== res.entryPath) {
        navigate(res.entryPath, { replace: true });
      }
      onUpdated();
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存登录地址失败');
    } finally {
      setSavingPath(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-amber-500/30 bg-netease-dark p-5 shadow-2xl">
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <ShieldCheck className="h-5 w-5 text-amber-400" />
          完成初始安全设置
        </div>
        <p className="mt-2 text-sm text-netease-muted">
          首次登录须修改账号密码，并将管理入口改为随机路径。完成前无法使用其它管理功能。
        </p>

        {overview.mustChangeCredentials && (
          <div className="mt-5">
            <CredentialsPanel
              adminUsername={overview.adminUsername || 'admin'}
              persisted={overview.credentialsPersisted ?? false}
              forced
              onError={onError}
              onSaved={onUpdated}
            />
          </div>
        )}

        {overview.mustChangeEntryPath && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/5">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
              <Link2 className="h-4 w-4 text-netease-muted" />
              登录地址
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">必须修改</span>
            </div>
            <div className="space-y-3 px-4 py-3">
              <p className="text-xs text-netease-muted">请改成随机路径并收藏；默认 /admin 将无法再作为入口</p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-white/10 bg-black/20 px-2">
                  <span className="shrink-0 select-none pl-1 text-xs text-netease-muted">
                    {typeof window !== 'undefined' ? window.location.origin : ''}
                  </span>
                  <input
                    value={entryPathDraft}
                    onChange={(e) => setEntryPathDraft(e.target.value)}
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent py-2.5 font-mono text-sm text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setEntryPathDraft(createRandomEntryPath())}
                    className="shrink-0 rounded-lg p-2 text-netease-muted hover:bg-white/10 hover:text-white"
                    aria-label="随机生成"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void saveEntryPath()}
                  disabled={savingPath || !entryPathDraft.trim() || entryPathDraft === '/admin'}
                  className="rounded-xl bg-netease-red px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {savingPath ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存地址'}
                </button>
              </div>
              {pathHint && <p className="text-xs text-emerald-400/90">{pathHint}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type RuntimeTextField = Exclude<
  keyof RuntimeConfig,
  'roomEmptyTtlMs' | 'configuredSecrets' | 'metingApiUrl' | 'metingApiAuth' | 'metingSources'
>;

interface RuntimeFieldDef {
  key: RuntimeTextField;
  label: string;
  placeholder?: string;
  secret?: boolean;
  /** 字段用途说明 */
  tip?: string;
}

interface RuntimeFieldGroup {
  id: string;
  title: string;
  /** 配置后能做什么 */
  purpose: string;
  fields: RuntimeFieldDef[];
  /** 是否在本组末尾渲染七牛区域下拉 */
  includeQiniuZone?: boolean;
}

const RUNTIME_FIELD_GROUPS: RuntimeFieldGroup[] = [
  {
    id: 'cyapi',
    title: '迟言 API',
    purpose: '酷狗（蓝点）音乐搜索与播放；也可用于部分图片审核能力。不配置则蓝点音源不可用。',
    fields: [
      { key: 'cyapiBase', label: 'API 地址', placeholder: 'https://cyapi.top/API' },
      { key: 'cyapiKey', label: 'API 密钥', secret: true },
    ],
  },
  {
    id: 'lyrics',
    title: '歌词备用',
    purpose: '主音源拿不到歌词时，按歌名向该接口兜底拉取。一般保持默认即可。',
    fields: [
      { key: 'vmyLrcUrl', label: '备用歌词 API', placeholder: 'https://api.52vmy.cn/api/music/lrc' },
    ],
  },
  {
    id: 'qiniu',
    title: '七牛云存储',
    purpose: '房间聊天发图依赖此项。四项齐全后才能上传图片；缺一则无法发送图片消息。',
    includeQiniuZone: true,
    fields: [
      { key: 'qiniuAccessKey', label: 'Access Key', secret: true },
      { key: 'qiniuSecretKey', label: 'Secret Key', secret: true },
      { key: 'qiniuBucket', label: 'Bucket', tip: '对象存储空间名称' },
      { key: 'qiniuDomain', label: 'CDN 域名', placeholder: 'https://cdn.example.com', tip: '对外访问图片用的域名，需带 https://' },
    ],
  },
  {
    id: 'apihz',
    title: '接口盒子',
    purpose: '表情包搜索与聊天敏感词检测共用。不配置则表情搜索 / 敏感词过滤不可用。',
    fields: [
      { key: 'apihzBaseUrl', label: 'API 地址', placeholder: 'https://cn.apihz.cn/api' },
      { key: 'apihzId', label: '用户 ID', secret: true },
      { key: 'apihzKey', label: '密钥', secret: true },
    ],
  },
];

function RuntimeConfigPanel({ onError }: { onError: (message: string) => void }) {
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  /** 用户改过的密钥字段；未改动的保存时保持原值 */
  const [dirtySecrets, setDirtySecrets] = useState<Set<string>>(new Set());
  /** 用户改过 Auth 的音源下标 */
  const [dirtyMetingAuth, setDirtyMetingAuth] = useState<Set<number>>(new Set());
  const [baselineSecrets, setBaselineSecrets] = useState<Record<string, string>>({});
  const [baselineMetingAuth, setBaselineMetingAuth] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState('');

  const applyLoadedConfig = (config: RuntimeConfig) => {
    setDraft(config);
    setDirtySecrets(new Set());
    setDirtyMetingAuth(new Set());
    const secrets: Record<string, string> = {};
    for (const group of RUNTIME_FIELD_GROUPS) {
      for (const field of group.fields) {
        if (field.secret) secrets[field.key] = config[field.key] || '';
      }
    }
    setBaselineSecrets(secrets);
    setBaselineMetingAuth(config.metingSources.map((source) => source.auth || ''));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config');
        if (!cancelled) applyLoadedConfig(res.config);
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : '加载运行配置失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setHint('');
    try {
      const clearSecrets: string[] = [];
      const payload: RuntimeConfig & { clearSecrets: string[] } = {
        ...draft,
        clearSecrets,
        metingSources: draft.metingSources.map((source, index) => {
          if (!dirtyMetingAuth.has(index)) {
            return { ...source, auth: '', clearAuth: false };
          }
          if (!String(source.auth || '').trim()) {
            return { ...source, auth: '', clearAuth: true };
          }
          return { ...source, clearAuth: false };
        }),
      };

      for (const group of RUNTIME_FIELD_GROUPS) {
        for (const field of group.fields) {
          if (!field.secret) continue;
          if (!dirtySecrets.has(field.key)) {
            payload[field.key] = '';
            continue;
          }
          if (!String(payload[field.key] || '').trim()) {
            clearSecrets.push(field.key);
            payload[field.key] = '';
          }
        }
      }

      const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      applyLoadedConfig(res.config);
      setHint('已保存并立即生效');
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存运行配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="flex items-center justify-center py-10 text-netease-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  const markSecretDirty = (key: RuntimeTextField, nextValue: string) => {
    setDirtySecrets((prev) => {
      const next = new Set(prev);
      if (nextValue === (baselineSecrets[key] || '')) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderField = (field: RuntimeFieldDef) => {
    const configured = Boolean(draft.configuredSecrets[field.key]);
    const dirty = dirtySecrets.has(field.key);
    return (
      <label key={field.key} className="block">
        <span className="mb-1 flex items-center gap-1.5 text-xs text-netease-muted">
          {field.label}
          {field.secret && configured && !dirty && (
            <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] text-emerald-400">已配置</span>
          )}
          {field.secret && dirty && !String(draft[field.key] || '').trim() && (
            <span className="rounded bg-amber-500/15 px-1 py-px text-[10px] text-amber-400">保存后关闭</span>
          )}
        </span>
        <input
          type="text"
          value={draft[field.key]}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraft({ ...draft, [field.key]: nextValue });
            if (field.secret) markSecretDirty(field.key, nextValue);
          }}
          placeholder={field.secret
            ? (configured ? '清空保存则关闭该功能' : '填入后启用')
            : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:font-sans placeholder:text-netease-muted/50"
        />
        {field.tip && (
          <p className="mt-1 text-[11px] text-netease-muted/80">{field.tip}</p>
        )}
      </label>
    );
  };

  const updateMetingSource = (
    index: number,
    patch: Partial<RuntimeConfig['metingSources'][number]>,
  ) => {
    const metingSources = draft.metingSources.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    ));
    setDraft({ ...draft, metingSources });
  };

  return (
    <>
      <SettingsSection
        title="房间"
        description="无人房间保留多久后自动销毁；设为 0 表示最后一人离开立即销毁。"
      >
        <div className="flex max-w-xs items-center gap-2">
          <input
            type="number"
            min={0}
            max={1440}
            step={1}
            value={Math.round(draft.roomEmptyTtlMs / 60000)}
            onChange={(e) => setDraft({ ...draft, roomEmptyTtlMs: Math.max(0, Number(e.target.value) || 0) * 60000 })}
            aria-label="空房销毁时间（分钟）"
            className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none"
          />
          <span className="text-xs text-netease-muted">分钟后销毁空房</span>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Meting 音源"
        description={(
          <>
            网易云 / QQ 音乐的搜索、播放、歌词与歌单导入。多个源轮询使用，故障自动切换。
            <br />
            <span className="text-sky-300/80">ChKSz 源仅支持网易云，无需 Auth。</span>
          </>
        )}
      >
        {draft.metingSources.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/15 py-5 text-center text-xs text-netease-muted">
            暂无音源，点击下方按钮添加
          </div>
        )}
        {draft.metingSources.map((source, index) => (
          <div key={`${index}-${source.type}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="grid gap-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]">
              <AdminSelect
                value={source.type}
                ariaLabel={`音源 ${index + 1} 类型`}
                options={[
                  { value: 'meting', label: 'Meting' },
                  { value: 'chksz', label: 'ChKSz' },
                ]}
                onChange={(type) => updateMetingSource(index, {
                  type,
                  url: type === 'chksz' && !source.url ? 'https://api.chksz.com' : source.url,
                })}
              />
              <input
                type="url"
                value={source.url}
                onChange={(e) => updateMetingSource(index, { url: e.target.value })}
                placeholder={source.type === 'chksz' ? 'https://api.chksz.com' : 'API 地址，如 https://music-api.example.com'}
                aria-label={`音源 ${index + 1} 地址`}
                spellCheck={false}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:font-sans placeholder:text-netease-muted/50"
              />
              <button
                type="button"
                onClick={() => {
                  setDraft({
                    ...draft,
                    metingSources: draft.metingSources.filter((_, sourceIndex) => sourceIndex !== index),
                  });
                  setDirtyMetingAuth((prev) => {
                    const next = new Set<number>();
                    for (const dirtyIndex of prev) {
                      if (dirtyIndex < index) next.add(dirtyIndex);
                      else if (dirtyIndex > index) next.add(dirtyIndex - 1);
                    }
                    return next;
                  });
                  setBaselineMetingAuth((prev) => prev.filter((_, sourceIndex) => sourceIndex !== index));
                }}
                aria-label={`删除音源 ${index + 1}`}
                className="justify-self-end self-center rounded-lg p-2 text-netease-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <input
                type="text"
                value={source.auth || ''}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  updateMetingSource(index, { auth: nextValue, clearAuth: false });
                  setDirtyMetingAuth((prev) => {
                    const next = new Set(prev);
                    if (nextValue === (baselineMetingAuth[index] || '')) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }}
                placeholder={source.configuredAuth
                  ? '清空保存则关闭 Auth'
                  : `Auth 密钥${source.type === 'chksz' ? '（通常不需要）' : '，没有则留空'}`}
                aria-label={`音源 ${index + 1} Auth 密钥`}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:font-sans placeholder:text-netease-muted/50"
              />
              {source.configuredAuth && !dirtyMetingAuth.has(index) && (
                <span className="text-[10px] text-emerald-400">已配置</span>
              )}
              {dirtyMetingAuth.has(index) && !String(source.auth || '').trim() && (
                <span className="text-[10px] text-amber-400">保存后关闭</span>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            if (draft.metingSources.length >= 20) return;
            setDraft({
              ...draft,
              metingSources: [
                ...draft.metingSources,
                { type: 'meting', url: '', auth: '', configuredAuth: false },
              ],
            });
          }}
          disabled={draft.metingSources.length >= 20}
          className="flex items-center gap-1.5 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs text-netease-muted transition-colors hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          添加音源
        </button>
      </SettingsSection>

      {RUNTIME_FIELD_GROUPS.map((group) => (
        <SettingsSection key={group.id} title={group.title} description={group.purpose}>
          <div className="grid gap-3 sm:grid-cols-2">
            {group.fields.map(renderField)}
            {group.includeQiniuZone && (
              <div>
                <span className="mb-1 block text-xs text-netease-muted">存储区域</span>
                <AdminSelect
                  value={draft.qiniuZone}
                  ariaLabel="七牛存储区域"
                  options={[
                    { value: 'z0', label: '华东 z0' },
                    { value: 'z1', label: '华北 z1' },
                    { value: 'z2', label: '华南 z2' },
                    { value: 'na0', label: '北美 na0' },
                    { value: 'as0', label: '东南亚 as0' },
                  ]}
                  onChange={(zone) => setDraft({ ...draft, qiniuZone: zone })}
                />
                <p className="mt-1 text-[11px] text-netease-muted/80">须与创建 Bucket 时选的区域一致</p>
              </div>
            )}
          </div>
        </SettingsSection>
      ))}

      {/* 吸底保存栏：长页面滚动到哪都能保存 */}
      <div className="sticky bottom-0 z-10 -mx-4 rounded-b-2xl border-t border-white/10 bg-netease-dark/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-netease-muted">
            {hint
              ? <span className="text-emerald-400/90">{hint}</span>
              : '密钥回显为首尾片段；未改动保持原值，清空保存则关闭，填入则更新'}
          </p>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="shrink-0 rounded-xl bg-netease-red px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存配置'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  // null = 正在用 HttpOnly Cookie 探测会话；不把 token 放进 JS 可读存储
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [error, setError] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [protectingId, setProtectingId] = useState<string | null>(null);
  const [entryPathDraft, setEntryPathDraft] = useState(
    () => (typeof window !== 'undefined' ? window.location.pathname : ''),
  );
  const [savingPath, setSavingPath] = useState(false);
  const [pathHint, setPathHint] = useState('');
  const [annEnabled, setAnnEnabled] = useState(false);
  const [annTitle, setAnnTitle] = useState('站点公告');
  const [annText, setAnnText] = useState('');
  const [annBumpId, setAnnBumpId] = useState(false);
  const [annSaving, setAnnSaving] = useState(false);
  const [annHint, setAnnHint] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastHint, setBroadcastHint] = useState('');
  const [bans, setBans] = useState<SiteBanEntry[]>([]);
  const [banType, setBanType] = useState<'ip' | 'device'>('ip');
  const [banValue, setBanValue] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banSaving, setBanSaving] = useState(false);
  const [banHint, setBanHint] = useState('');
  const [errorReports, setErrorReports] = useState<ErrorReportSummary[]>([]);
  const [reportDetail, setReportDetail] = useState<ErrorReportDetail | null>(null);
  const [reportDetailLoading, setReportDetailLoading] = useState(false);
  const [reportBusyId, setReportBusyId] = useState<string | null>(null);
  const [reportNoteDraft, setReportNoteDraft] = useState('');
  const [upstreamBusyUrl, setUpstreamBusyUrl] = useState<string | null>(null);
  const [auditItems, setAuditItems] = useState<AdminAuditEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const annLoadedRef = useRef(false);
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
    setBans([]);
    setErrorReports([]);
    setReportDetail(null);
    setAuditItems([]);
    setAuditTotal(0);
    setAuditPage(1);
  }, []);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [ov, rm, banRes, reportRes] = await Promise.all([
        adminFetch<AdminOverview>('/api/admin/overview'),
        adminFetch<{ rooms: AdminRoom[] }>('/api/admin/rooms'),
        adminFetch<{ bans: SiteBanEntry[] }>('/api/admin/bans'),
        adminFetch<{ reports: ErrorReportSummary[] }>('/api/admin/error-reports'),
      ]);
      setOverview(ov);
      setRooms(rm.rooms);
      setBans(banRes.bans);
      setErrorReports(reportRes.reports);
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
    }
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [loggedIn, refresh]);

  const loadAudit = useCallback(async (page: number) => {
    setAuditLoading(true);
    try {
      const res = await adminFetch<{
        items: AdminAuditEntry[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>(`/api/admin/audit?page=${page}&pageSize=${AUDIT_PAGE_SIZE}`);
      const maxPage = Math.max(1, res.totalPages || 1);
      if (page > maxPage) {
        setAuditPage(maxPage);
        return;
      }
      setAuditItems(res.items);
      setAuditTotal(res.total);
      setAuditPage(res.page);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loggedIn || activeTab !== 'audit') return;
    void loadAudit(auditPage);
  }, [loggedIn, activeTab, auditPage, loadAudit]);

  // 公告只在登录后拉一次，避免轮询覆盖正在编辑的内容
  useEffect(() => {
    if (!loggedIn || annLoadedRef.current) return;
    (async () => {
      try {
        const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement');
        annLoadedRef.current = true;
        setAnnEnabled(res.announcement.enabled);
        setAnnTitle(res.announcement.title || '站点公告');
        setAnnText(res.announcement.text || '');
      } catch {
        // 拉取失败不阻塞面板，保存时仍可覆盖
      }
    })();
  }, [loggedIn]);

  const saveAnnouncement = useCallback(async () => {
    if (annSaving) return;
    setAnnSaving(true);
    setAnnHint('');
    try {
      const res = await adminFetch<{ announcement: SiteAnnouncementConfig }>('/api/admin/announcement', {
        method: 'PUT',
        body: JSON.stringify({
          enabled: annEnabled,
          title: annTitle.trim(),
          text: annText.trim(),
          bumpId: annBumpId,
        }),
      });
      setAnnEnabled(res.announcement.enabled);
      setAnnTitle(res.announcement.title);
      setAnnText(res.announcement.text);
      setAnnBumpId(false);
      setAnnHint(res.announcement.enabled
        ? (annBumpId ? '已保存并作为新公告发布（所有用户重新弹窗）' : '已保存')
        : '已保存（公告处于停用状态）');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存公告失败');
    } finally {
      setAnnSaving(false);
    }
  }, [annBumpId, annEnabled, annSaving, annText, annTitle]);

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

  const toggleRoomProtection = useCallback(async (room: AdminRoom) => {
    setProtectingId(room.id);
    try {
      await adminFetch(`/api/admin/rooms/${room.id}/protection`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !room.protectedFromDestroy }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新房间保活状态失败');
    } finally {
      setProtectingId(null);
    }
  }, [refresh]);

  const resetUpstreamCooldown = useCallback(async (url: string) => {
    setUpstreamBusyUrl(url);
    try {
      await adminFetch('/api/admin/meting/reset-cooldown', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置冷却失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [refresh]);

  const toggleUpstreamDisabled = useCallback(async (up: MetingUpstreamStatus) => {
    setUpstreamBusyUrl(up.url);
    try {
      await adminFetch('/api/admin/meting/disable', {
        method: 'POST',
        body: JSON.stringify({ url: up.url, disabled: !up.disabled }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新上游状态失败');
    } finally {
      setUpstreamBusyUrl(null);
    }
  }, [refresh]);

  const sendBroadcast = useCallback(async () => {
    if (broadcasting || !broadcastText.trim()) return;
    setBroadcasting(true);
    setBroadcastHint('');
    try {
      const res = await adminFetch<{ roomCount: number }>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ text: broadcastText.trim() }),
      });
      setBroadcastText('');
      setBroadcastHint(`已发送到 ${res.roomCount} 个房间`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '广播失败');
    } finally {
      setBroadcasting(false);
    }
  }, [broadcastText, broadcasting, refresh]);

  const addBan = useCallback(async () => {
    if (banSaving || !banValue.trim()) return;
    setBanSaving(true);
    setBanHint('');
    try {
      const res = await adminFetch<{ kicked: number }>('/api/admin/bans', {
        method: 'POST',
        body: JSON.stringify({
          type: banType,
          value: banValue.trim(),
          reason: banReason.trim(),
        }),
      });
      setBanValue('');
      setBanReason('');
      setBanHint(`已封禁${typeof res.kicked === 'number' && res.kicked > 0 ? `，踢出 ${res.kicked} 个在线连接` : ''}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '封禁失败');
    } finally {
      setBanSaving(false);
    }
  }, [banReason, banSaving, banType, banValue, refresh]);

  const removeBan = useCallback(async (banId: string) => {
    try {
      await adminFetch(`/api/admin/bans/${banId}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解封失败');
    }
  }, [refresh]);

  const openErrorReport = useCallback(async (id: string) => {
    setReportDetailLoading(true);
    try {
      const res = await adminFetch<{ report: ErrorReportDetail }>(`/api/admin/error-reports/${id}`);
      setReportDetail(res.report);
      setReportNoteDraft(res.report.note || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载上报详情失败');
    } finally {
      setReportDetailLoading(false);
    }
  }, []);

  const resolveErrorReport = useCallback(async (id: string, status: 'open' | 'resolved') => {
    setReportBusyId(id);
    try {
      const payload: { status: 'open' | 'resolved'; note?: string } = { status };
      if (reportDetail?.id === id) payload.note = reportNoteDraft;
      const res = await adminFetch<{ report: ErrorReportDetail }>(`/api/admin/error-reports/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (reportDetail?.id === id) setReportDetail(res.report);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新上报失败');
    } finally {
      setReportBusyId(null);
    }
  }, [refresh, reportDetail?.id, reportNoteDraft]);

  const deleteErrorReportItem = useCallback(async (id: string) => {
    if (!window.confirm('确定删除这条错误上报？')) return;
    setReportBusyId(id);
    try {
      await adminFetch(`/api/admin/error-reports/${id}`, { method: 'DELETE' });
      if (reportDetail?.id === id) setReportDetail(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除上报失败');
    } finally {
      setReportBusyId(null);
    }
  }, [refresh, reportDetail?.id]);

  const quickBan = useCallback((type: 'ip' | 'device', value: string) => {
    if (!value) return;
    setBanType(type);
    setBanValue(value);
    setBanHint(`已填入${type === 'ip' ? ' IP' : ' deviceId'}，确认后点击「添加封禁」`);
    setActiveTab('bans');
  }, []);

  const randomizeEntryPath = useCallback(() => {
    setEntryPathDraft(createRandomEntryPath());
    setPathHint('已生成随机地址，点击保存后生效');
  }, []);

  const roomsPage = useClientPage(rooms, LIST_PAGE_SIZE);
  const bansPage = useClientPage(bans, LIST_PAGE_SIZE);
  const reportsPage = useClientPage(errorReports, LIST_PAGE_SIZE);

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

  const openReportCount = errorReports.filter((r) => r.status === 'open').length;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE) || 1);

  const renderMenuButton = (tab: (typeof ADMIN_TABS)[number], compact: boolean) => {
    const Icon = tab.icon;
    const active = activeTab === tab.id;
    return (
      <button
        key={tab.id}
        type="button"
        onClick={() => setActiveTab(tab.id)}
        className={`flex shrink-0 items-center gap-2.5 rounded-xl text-sm transition-colors ${
          compact ? 'px-3 py-2' : 'w-full px-3.5 py-2.5'
        } ${
          active
            ? 'bg-netease-red/15 font-medium text-netease-red'
            : 'text-netease-muted hover:bg-white/5 hover:text-white'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {tab.label}
        {tab.id === 'reports' && openReportCount > 0 && (
          <span className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-netease-red px-1 text-[10px] font-semibold text-white ${
            compact ? '' : 'ml-auto'
          }`}
          >
            {openReportCount}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-netease-dark text-white">
      {overview?.setupRequired && (
        <InitialSetupGate
          overview={overview}
          onError={setError}
          onUpdated={() => void refresh()}
        />
      )}
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6 sm:px-6">
        {/* 桌面端侧边菜单 */}
        <aside className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-6 flex flex-col gap-5">
            <div className="flex items-center gap-2 px-1 text-base font-semibold">
              <ShieldCheck className="h-5 w-5 shrink-0 text-netease-red" />
              站点管理后台
            </div>
            <nav className="flex flex-col gap-1">
              {ADMIN_TABS.map((tab) => renderMenuButton(tab, false))}
            </nav>
            <div className="flex flex-col gap-1 border-t border-white/10 pt-3">
              <button
                onClick={() => void logout()}
                className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          {/* 移动端头部 + 横向菜单 */}
          <div className="md:hidden">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="h-5 w-5 text-netease-red" />
                站点管理后台
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void logout()}
                  aria-label="退出登录"
                  className="rounded-lg p-2 text-netease-muted transition-colors hover:bg-white/5 hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1">
              {ADMIN_TABS.map((tab) => renderMenuButton(tab, true))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
              {error}
            </div>
          )}

          <header className="px-1">
            <h2 className="text-lg font-semibold text-white">{TAB_META[activeTab].title}</h2>
            <p className="mt-0.5 text-xs text-netease-muted">{TAB_META[activeTab].description}</p>
          </header>

          {activeTab === 'settings' && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 sm:px-5">
            <div className="divide-y divide-white/10">
              <SettingsSection
                title="登录地址"
                description="管理后台的入口路径。修改后旧地址失效，请收藏新链接。"
              >
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
                      placeholder="/随机路径"
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
              </SettingsSection>

              <SettingsSection
                title="管理员账号"
                badge={(
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-normal ${
                    (overview?.credentialsPersisted ?? true)
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-rose-500/20 text-rose-300'
                  }`}
                  >
                    {(overview?.credentialsPersisted ?? true) ? 'Redis 持久化' : 'Redis 未就绪'}
                  </span>
                )}
                description="密码以 scrypt 哈希存 Redis；新密码至少 8 位。修改后其它登录会话立即失效。"
              >
                <CredentialsPanel
                  bare
                  adminUsername={overview?.adminUsername || ''}
                  persisted={overview?.credentialsPersisted ?? true}
                  onError={setError}
                  onSaved={() => void refresh()}
                />
              </SettingsSection>

              <RuntimeConfigPanel onError={setError} />
            </div>
          </div>
          )}

          {activeTab === 'notify' && (
          <>
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Megaphone className="h-4 w-4 text-netease-muted" />
              首页站点公告
            </div>
            <AdminSwitch checked={annEnabled} onChange={setAnnEnabled} label="启用" />
          </div>
          <div className="space-y-3 px-4 py-3">
            <input
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              maxLength={40}
              placeholder="公告标题"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
            />
            <textarea
              value={annText}
              onChange={(e) => setAnnText(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="公告内容（支持换行）"
              className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <AdminCheckbox
                checked={annBumpId}
                onChange={setAnnBumpId}
                label="作为新公告发布（已读用户重新弹窗）"
              />
              <button
                type="button"
                onClick={() => void saveAnnouncement()}
                disabled={annSaving || (annEnabled && !annText.trim())}
                className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {annSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存公告'}
              </button>
            </div>
            {annHint && <p className="text-xs text-emerald-400/90">{annHint}</p>}
            <p className="text-[11px] text-netease-muted">
              保存后立即生效，并写入 Redis 持久化
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Radio className="h-4 w-4 text-netease-muted" />
            全局广播
          </div>
          <div className="space-y-3 px-4 py-3">
            <textarea
              value={broadcastText}
              onChange={(e) => setBroadcastText(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="向所有房间发送系统通知（维护 / 活动预告）"
              className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-netease-muted">会写入各房间聊天记录，并弹出短暂提示</p>
              <button
                type="button"
                onClick={() => void sendBroadcast()}
                disabled={broadcasting || !broadcastText.trim()}
                className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {broadcasting ? <Loader2 className="h-4 w-4 animate-spin" /> : '发送广播'}
              </button>
            </div>
            {broadcastHint && <p className="text-xs text-emerald-400/90">{broadcastHint}</p>}
          </div>
        </div>
          </>
          )}

          {activeTab === 'overview' && (
          <>
        {!overview && (
          <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 py-12 text-netease-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<Music className="h-3.5 w-3.5" />} label="房间数" value={overview.roomCount} />
            <StatCard icon={<Users className="h-3.5 w-3.5" />} label="在线用户" value={overview.onlineUsers} />
            <StatCard icon={<Activity className="h-3.5 w-3.5" />} label="播放中房间" value={overview.playingRooms} />
            <StatCard icon={<Wifi className="h-3.5 w-3.5" />} label="Socket 连接" value={overview.connectedSockets} />
            <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="运行时长" value={formatUptime(overview.uptimeSec)} />
            <StatCard icon={<MemoryStick className="h-3.5 w-3.5" />} label="内存占用" value={`${overview.memoryRssMb} MB`} />
            <StatCard
              icon={<Database className="h-3.5 w-3.5" />}
              label="持久化存储"
              value={overview.redisEnabled ? 'Redis' : '未连接'}
            />
          </div>
        )}

        {overview && overview.metingUpstreams.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="border-b border-white/10 px-4 py-3 text-sm font-medium">
              Meting 音源上游（
              {overview.metingUpstreams.filter((u) => u.healthy && !u.disabled).length}
              /
              {overview.metingUpstreams.length}
              {' '}健康）
            </div>
            <div className="divide-y divide-white/5">
              {overview.metingUpstreams.map((up) => (
                <div key={up.url} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${
                    up.disabled ? 'bg-zinc-500' : up.healthy ? 'bg-emerald-400' : 'bg-red-400'
                  }`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {up.url}
                    {up.style === 'chksz' && (
                      <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">chksz</span>
                    )}
                    {up.disabled && (
                      <span className="ml-2 rounded bg-zinc-500/30 px-1.5 py-0.5 text-[10px] text-zinc-300">已禁用</span>
                    )}
                  </span>
                  <span className="text-xs text-netease-muted">
                    成功 {up.okCount} · 失败 {up.failCount}
                    {!up.disabled && !up.healthy && ` · 冷却 ${up.cooldownRemainingSec}s`}
                    {typeof up.lastProbeAgoSec === 'number' && ` · 探测 ${up.lastProbeAgoSec}s 前${up.lastProbeOk === false ? '（失败）' : ''}`}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={upstreamBusyUrl === up.url || up.disabled || up.cooldownRemainingSec <= 0}
                      onClick={() => void resetUpstreamCooldown(up.url)}
                      className="inline-flex h-7 min-w-[4.5rem] items-center justify-center rounded-lg border border-white/10 px-2.5 text-[11px] text-netease-muted transition-colors hover:bg-white/5 hover:text-white disabled:opacity-40"
                    >
                      {upstreamBusyUrl === up.url ? <Loader2 className="h-3 w-3 animate-spin" /> : '重置冷却'}
                    </button>
                    <button
                      type="button"
                      disabled={upstreamBusyUrl === up.url}
                      onClick={() => void toggleUpstreamDisabled(up)}
                      className={`inline-flex h-7 min-w-[4.5rem] items-center justify-center rounded-lg border px-2.5 text-[11px] transition-colors disabled:opacity-40 ${
                        up.disabled
                          ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                          : 'border-amber-500/40 text-amber-400 hover:bg-amber-500/10'
                      }`}
                    >
                      {up.disabled ? '启用' : '临时禁用'}
                    </button>
                  </div>
                  {up.lastError && (
                    <span className="w-full truncate pl-6 text-[11px] text-red-400/80">{up.lastError}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
          </>
          )}

          {activeTab === 'bans' && (
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Ban className="h-4 w-4 text-netease-muted" />
            全站封禁（{bans.length}）
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="flex flex-wrap gap-2">
              <AdminSelect
                value={banType}
                ariaLabel="封禁类型"
                className="w-32"
                options={[
                  { value: 'ip', label: 'IP' },
                  { value: 'device', label: 'deviceId' },
                ]}
                onChange={setBanType}
              />
              <input
                value={banValue}
                onChange={(e) => setBanValue(e.target.value)}
                placeholder={banType === 'ip' ? '例如 1.2.3.4' : '客户端 deviceId'}
                className="min-w-[12rem] flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm text-white outline-none placeholder:text-netease-muted/60"
              />
              <input
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="原因（可选）"
                maxLength={80}
                className="min-w-[8rem] flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none placeholder:text-netease-muted/60"
              />
              <button
                type="button"
                onClick={() => void addBan()}
                disabled={banSaving || !banValue.trim()}
                className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
              >
                {banSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : '添加封禁'}
              </button>
            </div>
            {banHint && <p className="text-xs text-emerald-400/90">{banHint}</p>}
            <p className="text-[11px] text-netease-muted">
              封禁后无法进房 / 建房；可从「房间管理」成员旁一键填入 IP 或 deviceId
            </p>
            {bans.length === 0 ? (
              <div className="py-4 text-center text-sm text-netease-muted">暂无封禁记录</div>
            ) : (
              <>
              <div className="divide-y divide-white/5 rounded-xl border border-white/5">
                {bansPage.pageItems.map((ban) => (
                  <div key={ban.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-netease-muted">
                      {ban.type === 'ip' ? 'IP' : '设备'}
                    </span>
                    <span className="font-mono text-white/90">{ban.value}</span>
                    {ban.reason && <span className="text-netease-muted">{ban.reason}</span>}
                    <span className="text-netease-muted">{formatAuditTime(ban.at)}</span>
                    <button
                      type="button"
                      onClick={() => void removeBan(ban.id)}
                      className="ml-auto rounded-lg border border-white/10 px-2 py-1 text-netease-muted hover:bg-white/5 hover:text-white"
                    >
                      解封
                    </button>
                  </div>
                ))}
              </div>
              <AdminPagination
                page={bansPage.page}
                totalPages={bansPage.totalPages}
                total={bansPage.total}
                pageSize={bansPage.pageSize}
                onChange={bansPage.setPage}
                className="-mx-4 -mb-3 mt-1"
              />
              </>
            )}
          </div>
        </div>
          )}

          {activeTab === 'reports' && (
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Bug className="h-4 w-4 text-netease-muted" />
            错误上报（{errorReports.length}
            {errorReports.some((r) => r.status === 'open')
              ? `，待处理 ${errorReports.filter((r) => r.status === 'open').length}`
              : ''}
            ）
          </div>
          {errorReports.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-netease-muted">暂无用户上报</div>
          ) : (
            <>
            <div className="divide-y divide-white/5">
              {reportsPage.pageItems.map((report) => (
                <div key={report.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          report.status === 'open'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {report.status === 'open' ? '待处理' : '已处理'}
                      </span>
                      <span className="truncate text-sm text-white/90">{report.description}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-netease-muted">
                      {formatAuditTime(report.createdAt)}
                      {report.meta.nickname ? ` · ${report.meta.nickname}` : ''}
                      {report.meta.roomId ? ` · 房间 ${report.meta.roomId}` : ''}
                      {report.meta.trackName ? ` · ${report.meta.trackName}` : ''}
                      {report.ip ? ` · ${report.ip}` : ''}
                      {` · 日志 ${report.eventCount} 条`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openErrorReport(report.id)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-netease-muted hover:bg-white/5 hover:text-white"
                    >
                      查看
                    </button>
                    {report.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => void resolveErrorReport(report.id, 'resolved')}
                        disabled={reportBusyId === report.id}
                        className="flex items-center gap-1 rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                      >
                        {reportBusyId === report.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <CheckCircle2 className="h-3.5 w-3.5" />}
                        标记已处理
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void deleteErrorReportItem(report.id)}
                      disabled={reportBusyId === report.id}
                      className="flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <AdminPagination
              page={reportsPage.page}
              totalPages={reportsPage.totalPages}
              total={reportsPage.total}
              pageSize={reportsPage.pageSize}
              onChange={reportsPage.setPage}
            />
            </>
          )}
        </div>
          )}

        <Modal
          open={Boolean(reportDetail) || reportDetailLoading}
          onClose={() => {
            if (reportBusyId) return;
            setReportDetail(null);
          }}
          zIndex={90}
          panelClassName="relative flex max-h-[85vh] w-full max-w-3xl flex-col animate-fade-in overflow-hidden rounded-2xl border border-white/10 bg-netease-dark shadow-2xl"
        >
          {reportDetailLoading || !reportDetail ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-netease-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载上报详情…
            </div>
          ) : (
            <>
              <div className="border-b border-white/10 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      reportDetail.status === 'open'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {reportDetail.status === 'open' ? '待处理' : '已处理'}
                  </span>
                  <h3 className="text-sm font-semibold text-white">错误上报详情</h3>
                  <span className="font-mono text-[11px] text-netease-muted">{reportDetail.id}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-white/90">{reportDetail.description}</p>
                <p className="mt-1 text-xs text-netease-muted">
                  {formatAuditTime(reportDetail.createdAt)}
                  {reportDetail.userId ? ` · user ${reportDetail.userId}` : ''}
                  {reportDetail.ip ? ` · ${reportDetail.ip}` : ''}
                </p>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-netease-muted">
                  <div className="mb-1 font-medium text-white/80">上下文</div>
                  <pre className="whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {JSON.stringify(reportDetail.meta || {}, null, 2)}
                  </pre>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-netease-muted">
                  <div className="mb-1 font-medium text-white/80">
                    Debug 事件（{reportDetail.events?.length || 0}）
                  </div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {(reportDetail.events || [])
                      .map((ev) => `[${ev.at}] ${ev.name} ${ev.line}`)
                      .join('\n') || '（无）'}
                  </pre>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-netease-muted">
                  <div className="mb-1 font-medium text-white/80">Debug 快照</div>
                  <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {reportDetail.snapshot || '（无）'}
                  </pre>
                </div>
                <label className="block text-xs text-netease-muted">
                  处理备注
                  <input
                    value={reportNoteDraft}
                    onChange={(e) => setReportNoteDraft(e.target.value)}
                    maxLength={200}
                    placeholder="可选：处理说明"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-netease-muted/60"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setReportDetail(null)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-netease-muted hover:bg-white/5 hover:text-white"
                >
                  关闭
                </button>
                {reportDetail.status === 'resolved' ? (
                  <button
                    type="button"
                    onClick={() => void resolveErrorReport(reportDetail.id, 'open')}
                    disabled={reportBusyId === reportDetail.id}
                    className="rounded-xl border border-white/10 px-4 py-2 text-sm text-netease-muted hover:bg-white/5 hover:text-white disabled:opacity-50"
                  >
                    重开
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void resolveErrorReport(reportDetail.id, 'resolved')}
                    disabled={reportBusyId === reportDetail.id}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {reportBusyId === reportDetail.id && <Loader2 className="h-4 w-4 animate-spin" />}
                    标记已处理
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void deleteErrorReportItem(reportDetail.id)}
                  disabled={reportBusyId === reportDetail.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              </div>
            </>
          )}
        </Modal>

          {activeTab === 'rooms' && (
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Music className="h-4 w-4 text-netease-muted" />
            房间列表（{rooms.length}）
          </div>
          {rooms.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-netease-muted">当前没有活跃房间</div>
          ) : (
            <>
            <div className="divide-y divide-white/5">
              {roomsPage.pageItems.map((room) => (
                <div key={room.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{room.name}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-netease-muted">{room.id}</span>
                      {room.hasPassword && <span className="text-[10px] text-amber-400">密码房</span>}
                      {room.isLocked && <span className="text-[10px] text-red-400">已上锁</span>}
                      {room.protectedFromDestroy && <span className="text-[10px] text-emerald-400">保活</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-netease-muted">
                      {room.userCount} 人在线
                      {room.users.length > 0 && ` · ${room.users.map((u) => u.nickname).join('、')}`}
                    </div>
                    {room.users.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {room.users.map((u) => (
                          <span
                            key={u.id}
                            className="inline-flex max-w-full items-center gap-1 rounded bg-black/20 px-1.5 py-0.5 text-[10px] text-netease-muted"
                          >
                            <span className="truncate text-white/80">{u.nickname}</span>
                            {u.clientIp && (
                              <button
                                type="button"
                                title={`封禁 IP ${u.clientIp}`}
                                onClick={() => quickBan('ip', u.clientIp!)}
                                className="font-mono hover:text-amber-300"
                              >
                                {u.clientIp}
                              </button>
                            )}
                            {u.deviceId && (
                              <button
                                type="button"
                                title={`封禁设备 ${u.deviceId}`}
                                onClick={() => quickBan('device', u.deviceId!)}
                                className="max-w-[5.5rem] truncate font-mono hover:text-amber-300"
                              >
                                {u.deviceId}
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-xs text-netease-muted">
                      {room.currentSong
                        ? `${room.isPlaying ? '▶' : '⏸'} ${room.currentSong.name} - ${room.currentSong.artist}`
                        : '未在播放'}
                      {` · 队列 ${room.queueLength}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void toggleRoomProtection(room)}
                      disabled={protectingId === room.id}
                      className={`flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                        room.protectedFromDestroy
                          ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                          : 'border-white/10 text-netease-muted hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {protectingId === room.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <ShieldCheck className="h-3.5 w-3.5" />}
                      {room.protectedFromDestroy ? '取消保活' : '设为保活'}
                    </button>
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
            <AdminPagination
              page={roomsPage.page}
              totalPages={roomsPage.totalPages}
              total={roomsPage.total}
              pageSize={roomsPage.pageSize}
              onChange={roomsPage.setPage}
            />
            </>
          )}
        </div>
          )}

          {activeTab === 'audit' && (
        <div className="rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <ScrollText className="h-4 w-4 text-netease-muted" />
            操作审计（{auditTotal}，Redis 持久化）
          </div>
          {auditLoading && auditItems.length === 0 ? (
            <div className="flex items-center justify-center px-4 py-10 text-netease-muted">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : auditTotal === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-netease-muted">暂无操作记录</div>
          ) : (
            <>
            <div className={`divide-y divide-white/5 ${auditLoading ? 'opacity-60' : ''}`}>
              {auditItems.map((entry, idx) => (
                <div key={`${entry.at}-${entry.action}-${idx}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                  <span className="shrink-0 font-mono text-netease-muted">{formatAuditTime(entry.at)}</span>
                  <span className="min-w-0 flex-1 text-white/90">{formatAuditAction(entry)}</span>
                  {entry.ip && <span className="font-mono text-netease-muted">{entry.ip}</span>}
                </div>
              ))}
            </div>
            <AdminPagination
              page={auditPage}
              totalPages={auditTotalPages}
              total={auditTotal}
              pageSize={AUDIT_PAGE_SIZE}
              onChange={setAuditPage}
            />
            </>
          )}
        </div>
          )}
        </div>
      </div>
    </div>
  );
}
