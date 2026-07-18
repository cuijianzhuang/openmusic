import { fetchMeting, formatMetingFetchError } from './metingFetch.js';
import { fetchChksz, isMetingUnsupportedError } from './chkszAdapter.js';

// METING_API_URL 支持英文逗号分隔多个上游；METING_API_AUTH 同样支持逗号分隔：
// 与 URL 一一对应；只填一个则应用到所有上游。
// 上游可用 `chksz:` 前缀标记为 ChKSz API（https://api.chksz.com 会自动识别），
// 由 chkszAdapter.js 翻译为 Meting 语义参与负载均衡。
const RAW_URLS = String(process.env.METING_API_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const RAW_AUTHS = String(process.env.METING_API_AUTH || '')
  .split(',')
  .map((s) => s.trim());

const FAIL_COOLDOWN_MS = 60_000;

const upstreams = RAW_URLS.map((raw, i) => {
  let style = 'meting';
  let base = raw;
  if (base.toLowerCase().startsWith('chksz:')) {
    style = 'chksz';
    base = base.slice('chksz:'.length).trim();
  }
  base = base.replace(/\/$/, '');

  let hostname = '';
  try {
    hostname = new URL(base).hostname.toLowerCase();
  } catch {
    hostname = '';
  }
  if (hostname === 'api.chksz.com') style = 'chksz';

  const auth = RAW_AUTHS.length === 1 ? RAW_AUTHS[0] : (RAW_AUTHS[i] || '');
  return {
    base,
    style,
    auth,
    hostname,
    cooldownUntil: 0,
    okCount: 0,
    failCount: 0,
    lastError: '',
  };
});

let rrCursor = 0;

export function getMetingUpstreamBases() {
  return upstreams.map((u) => u.base);
}

export function isMetingApiHostname(hostname) {
  const target = String(hostname || '').toLowerCase();
  if (!target) return false;
  return upstreams.some((u) => u.hostname && u.hostname === target);
}

export function getMetingUpstreamStatus() {
  const now = Date.now();
  return upstreams.map((u) => ({
    url: u.base,
    style: u.style,
    healthy: now >= u.cooldownUntil,
    cooldownRemainingSec: Math.max(0, Math.ceil((u.cooldownUntil - now) / 1000)),
    okCount: u.okCount,
    failCount: u.failCount,
    lastError: u.lastError,
  }));
}

function buildUpstreamUrl(upstream, query) {
  const params = new URLSearchParams(query);
  if (upstream.auth && !params.has('auth')) {
    params.set('auth', upstream.auth);
  }
  return `${upstream.base}/api?${params.toString()}`;
}

// 轮询起点每次前移；冷却中的上游排到最后兜底（全部故障时仍会尝试）
function orderedUpstreams() {
  if (upstreams.length <= 1) return upstreams;
  const start = rrCursor % upstreams.length;
  rrCursor = (rrCursor + 1) % upstreams.length;
  const rotated = [...upstreams.slice(start), ...upstreams.slice(0, start)];
  const now = Date.now();
  return [
    ...rotated.filter((u) => now >= u.cooldownUntil),
    ...rotated.filter((u) => now < u.cooldownUntil),
  ];
}

function markFailure(upstream, err) {
  upstream.failCount += 1;
  upstream.cooldownUntil = Date.now() + FAIL_COOLDOWN_MS;
  upstream.lastError = typeof err === 'string' ? err : formatMetingFetchError(err);
}

function markSuccess(upstream) {
  upstream.okCount += 1;
  upstream.cooldownUntil = 0;
  upstream.lastError = '';
}

/**
 * 按查询参数请求 Meting API，多上游间轮询负载均衡：
 * 网络错误或 5xx 时将该上游置入 60s 冷却并自动切换下一个。
 */
export async function fetchMetingApi(query, options = {}, timeoutMs = 10000) {
  if (upstreams.length === 0) {
    throw new Error('未配置 METING_API_URL');
  }

  let lastError = null;
  for (const upstream of orderedUpstreams()) {
    try {
      const response = upstream.style === 'chksz'
        ? await fetchChksz(upstream.base, query, timeoutMs)
        : await fetchMeting(buildUpstreamUrl(upstream, query), options, timeoutMs);
      if (response.status >= 500) {
        markFailure(upstream, `上游返回 ${response.status}`);
        lastError = new Error(`Meting 上游返回 ${response.status}（${upstream.base}）`);
        continue;
      }
      markSuccess(upstream);
      return response;
    } catch (err) {
      // 该上游不支持此类请求（如 chksz 不支持 QQ 源 / FM）：跳过但不计故障
      if (isMetingUnsupportedError(err)) {
        lastError = err;
        continue;
      }
      markFailure(upstream, err);
      lastError = err;
    }
  }
  throw lastError || new Error('所有 Meting 上游均不可用');
}
