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
    lastProbeAt: 0,
    lastProbeOk: null,
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
    lastProbeAgoSec: u.lastProbeAt ? Math.max(0, Math.round((now - u.lastProbeAt) / 1000)) : null,
    lastProbeOk: u.lastProbeOk,
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

  const isSearch = String(query?.type || '') === 'search';
  let lastError = null;
  let emptySearchResponse = null;
  for (const upstream of orderedUpstreams()) {
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
      // 搜索返回空数组（上游临时限流/曲库缺失时常见）：不算失败，但换下一个上游再试；
      // 全部为空才把空结果返回给调用方（response.text 为缓冲实现，可重复读取）
      if (isSearch && response.status === 200) {
        try {
          const data = JSON.parse(await response.text());
          if (Array.isArray(data) && data.length === 0) {
            emptySearchResponse = response;
            continue;
          }
        } catch {
          // 非 JSON 响应按原样返回，交由调用方处理
        }
      }
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
  if (emptySearchResponse) return emptySearchResponse;
  throw lastError || new Error('所有 Meting 上游均不可用');
}

// ---------- 主动健康探测 ----------
// 每个周期探测冷却中的上游（故障后快速恢复）；健康上游每 5 个周期探测一次
// （在用户碰到之前发现故障）。METING_HEALTH_PROBE_INTERVAL_MS=0 关闭探测。
const HEALTH_PROBE_INTERVAL_MS = Math.max(
  0,
  parseInt(process.env.METING_HEALTH_PROBE_INTERVAL_MS ?? '60000', 10) || 0,
);
const HEALTHY_PROBE_EVERY_N_TICKS = 5;
const PROBE_TIMEOUT_MS = 8000;
// 用固定关键词做一次轻量搜索，netease 是所有上游风格都支持的探测面
const PROBE_QUERY = { server: 'netease', type: 'search', id: '晴天' };

let probeTick = 0;
let probeTimer = null;

async function probeUpstream(upstream) {
  upstream.lastProbeAt = Date.now();
  try {
    const response = upstream.style === 'chksz'
      ? await fetchChksz(upstream.base, PROBE_QUERY, PROBE_TIMEOUT_MS)
      : await fetchMeting(buildUpstreamUrl(upstream, PROBE_QUERY), {}, PROBE_TIMEOUT_MS);
    if (response.status >= 400 && response.status !== 404) {
      markFailure(upstream, `健康探测返回 ${response.status}`);
      upstream.lastProbeOk = false;
      return;
    }
    const wasUnhealthy = Date.now() < upstream.cooldownUntil;
    upstream.cooldownUntil = 0;
    upstream.lastError = '';
    upstream.lastProbeOk = true;
    if (wasUnhealthy) {
      console.log(`Meting 上游恢复：${upstream.base}`);
    }
  } catch (err) {
    markFailure(upstream, err);
    upstream.lastProbeOk = false;
  }
}

export function startMetingHealthProbe() {
  if (HEALTH_PROBE_INTERVAL_MS <= 0 || upstreams.length === 0 || probeTimer) return;
  probeTimer = setInterval(() => {
    probeTick += 1;
    const now = Date.now();
    for (const upstream of upstreams) {
      const unhealthy = now < upstream.cooldownUntil;
      if (unhealthy || probeTick % HEALTHY_PROBE_EVERY_N_TICKS === 0) {
        void probeUpstream(upstream);
      }
    }
  }, HEALTH_PROBE_INTERVAL_MS);
  probeTimer.unref();
  console.log(`🩺 Meting 健康探测已启动（间隔 ${HEALTH_PROBE_INTERVAL_MS / 1000}s，共 ${upstreams.length} 个上游）`);
}
