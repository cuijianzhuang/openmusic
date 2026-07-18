import { fetchMeting, formatMetingFetchError } from './metingFetch.js';
import { fetchChksz, isMetingUnsupportedError } from './chkszAdapter.js';
import { getRuntimeConfig } from './runtimeConfig.js';

// METING_API_URL 支持英文逗号分隔多个上游；METING_API_AUTH 同样支持逗号分隔：
// 与 URL 一一对应；只填一个则应用到所有上游。
// 上游可用 `chksz:` 前缀标记为 ChKSz API（https://api.chksz.com 会自动识别），
// 由 chkszAdapter.js 翻译为 Meting 语义参与负载均衡。
const FAIL_COOLDOWN_MS = 60_000;

let upstreams = [];
let upstreamSignature = '';

let rrCursor = 0;

function syncUpstreams() {
  const config = getRuntimeConfig();
  const signature = `${config.metingApiUrl}\n${config.metingApiAuth}`;
  if (signature === upstreamSignature) return;

  const rawUrls = String(config.metingApiUrl || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rawAuths = String(config.metingApiAuth || '').split(',').map((s) => s.trim());
  const previous = new Map(upstreams.map((upstream) => [upstream.base, upstream]));
  upstreams = rawUrls.map((raw, i) => {
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

    const old = previous.get(base);
    return {
      base,
      style,
      auth: rawAuths.length === 1 ? rawAuths[0] : (rawAuths[i] || ''),
      hostname,
      cooldownUntil: old?.cooldownUntil || 0,
      okCount: old?.okCount || 0,
      failCount: old?.failCount || 0,
      lastError: old?.lastError || '',
      disabled: Boolean(old?.disabled),
    };
  });
  upstreamSignature = signature;
  rrCursor = 0;
}

export function getMetingUpstreamBases() {
  syncUpstreams();
  return upstreams.map((u) => u.base);
}

export function isMetingApiHostname(hostname) {
  syncUpstreams();
  const target = String(hostname || '').toLowerCase();
  if (!target) return false;
  return upstreams.some((u) => u.hostname && u.hostname === target);
}

function findUpstream(url) {
  syncUpstreams();
  const target = String(url || '').trim().replace(/\/$/, '');
  return upstreams.find((u) => u.base === target) || null;
}

export function getMetingUpstreamStatus() {
  syncUpstreams();
  const now = Date.now();
  return upstreams.map((u) => ({
    url: u.base,
    style: u.style,
    disabled: Boolean(u.disabled),
    healthy: !u.disabled && now >= u.cooldownUntil,
    cooldownRemainingSec: u.disabled
      ? 0
      : Math.max(0, Math.ceil((u.cooldownUntil - now) / 1000)),
    okCount: u.okCount,
    failCount: u.failCount,
    lastError: u.lastError,
  }));
}

/** 手动清除冷却，立即参与调度（已禁用的上游仍保持禁用） */
export function resetMetingUpstreamCooldown(url) {
  const upstream = findUpstream(url);
  if (!upstream) return { success: false, error: '上游不存在' };
  upstream.cooldownUntil = 0;
  upstream.lastError = '';
  return { success: true, upstream: getMetingUpstreamStatus().find((u) => u.url === upstream.base) };
}

/** 临时禁用 / 启用上游；禁用时同时清冷却，启用后立即可调度 */
export function setMetingUpstreamDisabled(url, disabled) {
  const upstream = findUpstream(url);
  if (!upstream) return { success: false, error: '上游不存在' };
  upstream.disabled = Boolean(disabled);
  if (!upstream.disabled) {
    upstream.cooldownUntil = 0;
    upstream.lastError = '';
  }
  return { success: true, upstream: getMetingUpstreamStatus().find((u) => u.url === upstream.base) };
}

function buildUpstreamUrl(upstream, query) {
  const params = new URLSearchParams(query);
  if (upstream.auth && !params.has('auth')) {
    params.set('auth', upstream.auth);
  }
  return `${upstream.base}/api?${params.toString()}`;
}

// 轮询起点每次前移；冷却中的上游排到最后兜底（全部故障时仍会尝试）；禁用的完全跳过
function orderedUpstreams() {
  syncUpstreams();
  const enabled = upstreams.filter((u) => !u.disabled);
  if (enabled.length === 0) return [];
  if (enabled.length <= 1) return enabled;
  const start = rrCursor % enabled.length;
  rrCursor = (rrCursor + 1) % enabled.length;
  const rotated = [...enabled.slice(start), ...enabled.slice(0, start)];
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
  syncUpstreams();
  if (upstreams.length === 0) {
    throw new Error('未配置 METING_API_URL');
  }

  const candidates = orderedUpstreams();
  if (candidates.length === 0) {
    throw new Error('所有 Meting 上游均已禁用');
  }

  let lastError = null;
  for (const upstream of candidates) {
    try {
      const response = upstream.style === 'chksz'
        ? await fetchChksz(upstream.base, query, timeoutMs)
        : await fetchMeting(buildUpstreamUrl(upstream, query), options, timeoutMs);
      // 404 视为正常的“歌曲不存在”业务结果；其余 4xx/5xx 视为上游故障并触发切换
      if (response.status >= 400 && response.status !== 404) {
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
