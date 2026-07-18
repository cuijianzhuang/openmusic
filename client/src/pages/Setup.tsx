import { useMemo, useState } from 'react';
import { CheckCircle2, Copy, Database, Loader2, Music2, RefreshCw, ShieldCheck } from 'lucide-react';
import { AdminSwitch } from '../components/FormControls';
import { buildRecommendedNginxConfig } from '../lib/nginxRecommended';

type RedisMode = 'host' | 'url';

interface SetupResult {
  ok: boolean;
  restartRequired: boolean;
  adminPath: string;
  username: string;
  password: string;
}

function randomAdminPath() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `/${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

async function setupFetch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`);
  return data as T;
}

export default function Setup() {
  const initialOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const [siteUrl, setSiteUrl] = useState(initialOrigin);
  const [trustProxy, setTrustProxy] = useState(true);
  const [testMode, setTestMode] = useState(false);
  const [mode, setMode] = useState<RedisMode>('host');
  const [redisUrl, setRedisUrl] = useState('redis://127.0.0.1:6379/0');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('6379');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('0');
  const [metingApiUrl, setMetingApiUrl] = useState('http://127.0.0.1:3000');
  const [chkszApiUrl, setChkszApiUrl] = useState('https://api.chksz.com');
  const [metingApiAuth, setMetingApiAuth] = useState('');
  const [adminPath, setAdminPath] = useState(() => randomAdminPath());
  const [testing, setTesting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [redisOk, setRedisOk] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SetupResult | null>(null);
  const [appRoot, setAppRoot] = useState('/www/sjbmusic');
  const [nginxCopied, setNginxCopied] = useState(false);
  const [showNginx, setShowNginx] = useState(true);

  const redis = useMemo(() => (
    mode === 'url'
      ? { mode, url: redisUrl.trim() }
      : {
          mode,
          host: host.trim(),
          port: Number(port),
          username: username.trim(),
          password,
          database: Number(database),
        }
  ), [database, host, mode, password, port, redisUrl, username]);

  const nginxConfig = useMemo(
    () => buildRecommendedNginxConfig({ appRoot }),
    [appRoot],
  );

  const copyNginx = async () => {
    try {
      await navigator.clipboard.writeText(nginxConfig);
      setNginxCopied(true);
      window.setTimeout(() => setNginxCopied(false), 2000);
    } catch {
      setError('复制失败，请手动全选复制');
    }
  };

  const testRedis = async () => {
    setTesting(true);
    setError('');
    setRedisOk(false);
    try {
      await setupFetch('/api/setup/test-redis', { redis });
      setRedisOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redis 连接失败');
    } finally {
      setTesting(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError('');
    try {
      const data = await setupFetch<SetupResult>('/api/setup/complete', {
        siteUrl: siteUrl.trim(),
        trustProxy,
        testMode,
        adminPath: adminPath.trim(),
        metingApiUrl: metingApiUrl.trim(),
        chkszApiUrl: chkszApiUrl.trim(),
        metingApiAuth: metingApiAuth.trim(),
        redis,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  if (result) {
    return (
      <div className="min-h-screen bg-netease-dark px-4 py-8 text-white">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <div className="rounded-2xl border border-emerald-500/30 bg-white/5 p-6">
            <div className="flex items-center gap-2 text-xl font-semibold">
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
              初始化完成
            </div>
            <p className="mt-3 text-sm text-netease-muted">
              配置已保存且安装入口已锁定。请重启 OpenMusic 服务后继续。
            </p>
            <div className="mt-4 space-y-2 rounded-xl bg-black/25 p-4 text-sm">
              <p>账号：<code className="text-emerald-300">{result.username}</code></p>
              <p>密码：<code className="text-emerald-300">{result.password}</code></p>
              <p className="break-all">管理入口：<code className="text-emerald-300">{result.adminPath}</code></p>
            </div>
            <p className="mt-3 text-xs text-amber-300">
              账号密码仅展示这一次，请立即复制并收藏；遗失后需用 Redis 重置。
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-2.5 text-sm font-medium"
            >
              <RefreshCw className="h-4 w-4" />
              服务重启后刷新
            </button>
          </div>

          {showNginx && (
            <div className="rounded-2xl border border-sky-500/30 bg-white/5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-sky-300">Nginx location 片段</h2>
                  <p className="mt-1 text-xs text-netease-muted">
                    把下面这几个 <code className="text-white/70">location</code> 放进站点已有的 server 块（删掉原来的
                    <code className="text-white/70"> location / </code> 全站反代），静态直出、仅 API / WebSocket 回 Node。
                    保存后执行 <code className="text-white/70">nginx -t && nginx -s reload</code>。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNginx(false)}
                  className="rounded-lg px-2 py-1 text-xs text-netease-muted hover:bg-white/5 hover:text-white"
                >
                  关闭
                </button>
              </div>

              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-netease-muted">项目根目录（按服务器实际路径修改）</span>
                <input
                  value={appRoot}
                  onChange={(e) => setAppRoot(e.target.value)}
                  placeholder="/www/sjbmusic"
                  spellCheck={false}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm outline-none"
                />
              </label>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyNginx()}
                  className="flex items-center gap-1.5 rounded-xl bg-sky-500/20 px-3 py-2 text-xs font-medium text-sky-300 transition-colors hover:bg-sky-500/30"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {nginxCopied ? '已复制' : '复制配置'}
                </button>
              </div>

              <pre className="mt-3 max-h-[50vh] overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-white/85">
                {nginxConfig}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-netease-dark px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-netease-red" />
          <div>
            <h1 className="text-xl font-semibold">OpenMusic 首次部署</h1>
            <p className="text-xs text-netease-muted">填写 Redis 与音源，其余安全信息自动生成，无需手改配置文件</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Database className="h-4 w-4 text-netease-muted" />
            Redis 持久化
          </div>
          <div className="space-y-4 p-4">
            <div className="flex gap-2">
              {(['host', 'url'] as RedisMode[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setMode(item);
                    setRedisOk(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    mode === item ? 'bg-netease-red text-white' : 'bg-white/5 text-netease-muted'
                  }`}
                >
                  {item === 'host' ? '分项配置' : '连接 URL'}
                </button>
              ))}
            </div>

            {mode === 'url' ? (
              <label className="block">
                <span className="mb-1 block text-xs text-netease-muted">Redis URL</span>
                <input
                  value={redisUrl}
                  onChange={(e) => {
                    setRedisUrl(e.target.value);
                    setRedisOk(false);
                  }}
                  placeholder="redis://user:password@127.0.0.1:6379/0"
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm outline-none"
                />
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <SetupField label="主机" value={host} onChange={(value) => { setHost(value); setRedisOk(false); }} placeholder="127.0.0.1" />
                <SetupField label="端口" value={port} onChange={(value) => { setPort(value); setRedisOk(false); }} placeholder="6379" />
                <SetupField label="账号（可选）" value={username} onChange={(value) => { setUsername(value); setRedisOk(false); }} />
                <SetupField label="密码（可选）" value={password} onChange={(value) => { setPassword(value); setRedisOk(false); }} password />
                <SetupField label="数据库编号" value={database} onChange={(value) => { setDatabase(value); setRedisOk(false); }} placeholder="0" />
              </div>
            )}

            <button
              type="button"
              onClick={() => void testRedis()}
              disabled={testing}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm disabled:opacity-40"
            >
              {testing && <Loader2 className="h-4 w-4 animate-spin" />}
              {redisOk ? 'Redis 连接成功' : '测试 Redis 连接'}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium">
            <Music2 className="h-4 w-4 text-netease-muted" />
            音源（Meting API）
          </div>
          <div className="space-y-3 p-4">
            <SetupField
              label="标准 Meting 地址"
              value={metingApiUrl}
              onChange={setMetingApiUrl}
              placeholder="http://127.0.0.1:3000"
            />
            <SetupField
              label="ChKSz 地址（可选）"
              value={chkszApiUrl}
              onChange={setChkszApiUrl}
              placeholder="https://api.chksz.com"
            />
            <SetupField
              label="Meting 令牌（auth，可选）"
              value={metingApiAuth}
              onChange={setMetingApiAuth}
            />
            <p className="text-xs text-netease-muted">
              两类音源会同时保存并参与轮询与故障切换；ChKSz 通常无需 Auth。任一项可留空，也可稍后在管理后台「运行配置」中增删更多音源。
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <SetupField
            label="站点访问地址"
            value={siteUrl}
            onChange={setSiteUrl}
            placeholder="https://music.example.com"
          />
          <label className="block">
            <span className="mb-1 block text-xs text-netease-muted">管理面板入口（已随机生成）</span>
            <div className="flex gap-2">
              <input
                value={adminPath}
                onChange={(e) => setAdminPath(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setAdminPath(randomAdminPath())}
                className="rounded-xl border border-white/10 px-3"
                aria-label="重新生成管理入口"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </label>
          <AdminSwitch
            checked={trustProxy}
            onChange={setTrustProxy}
            label="使用 Nginx / 宝塔 / CDN 反向代理（推荐开启）"
          />
          <AdminSwitch
            checked={testMode}
            onChange={setTestMode}
            label="测试环境模式（允许 HTTP 访问）"
          />
          {testMode ? (
            <p className="text-xs text-amber-300/90">
              测试模式会放宽 HTTP 会话与请求签名限制，请勿用于正式公网环境。
            </p>
          ) : (
            <p className="text-xs text-emerald-300/80">
              生产模式：强制安全会话 Cookie，并对 API 请求进行签名校验。
            </p>
          )}
          <p className="text-xs text-netease-muted">
            将自动生成会话签名密钥、随机管理员账号密码、写入配置并锁定安装入口。
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => void install()}
          disabled={installing || !redisOk || !adminPath.trim()}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-netease-red py-3 text-sm font-medium disabled:opacity-40"
        >
          {installing && <Loader2 className="h-4 w-4 animate-spin" />}
          一键创建并保存配置
        </button>
      </div>
    </div>
  );
}

function SetupField({
  label,
  value,
  onChange,
  placeholder,
  password = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  password?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-netease-muted">{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none"
      />
    </label>
  );
}
