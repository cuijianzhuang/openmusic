import { fetchMeting, formatMetingFetchError } from './metingFetch.js';
import { fetchChksz, isMetingUnsupportedError } from './chkszAdapter.js';
import { getRuntimeConfig } from './runtimeConfig.js';

// METING_API_URL 支持英文逗号分隔多个上游；METING_API_AUTH 同样支持逗号分隔：
// 与 URL 一一对应；只填一个则应用到所有上游。
// 上游可用 `chksz:` 前缀标记为 ChKSz API（https://api.chksz.com 会自动识别），
// 由 chkszAdapter.js 翻译为 Meting 语义参与负载均衡。
const FAIL_COOLDOWN_MS = 60_000;
const UPSTREAM_ATTEMPTS = 2;

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

    const auth = rawAuths.length === 1 ? rawAuths[0] : (rawAuths[i] || '');
    const old = previous.get(base);
    const reuseHealth = old?.auth === auth && old?.style === style;
    return {
      base,
      style,
      auth,
      hostname,
      cooldownUntil: reuseHealth ? old.cooldownUntil : 0,
      okCount: reuseHealth ? old.okCount : 0,
      failCount: reuseHealth ? old.failCount : 0,
      lastError: reuseHealth ? old.lastError : '',
      disabled: Boolean(old?.disabled),
      lastProbeAt: reuseHealth ? old.lastProbeAt : 0,
      lastProbeOk: reuseHealth ? old.lastProbeOk : null,
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
    lastProbeAgoSec: u.lastProbeAt ? Math.max(0, Math.round((now - u.lastProbeAt) / 1000)) : null,
    lastProbeOk: u.lastProbeOk,
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
function orderedUpstreams(query = {}) {
  syncUpstreams();
  const enabled = upstreams.filter((u) => !u.disabled);
  if (enabled.length === 0) return [];
  if (enabled.length <= 1) return enabled;
  const start = rrCursor % enabled.length;
  rrCursor = (rrCursor + 1) % enabled.length;
  const rotated = [...enabled.slice(start), ...enabled.slice(0, start)];
  const now = Date.now();
  const healthy = rotated.filter((u) => now >= u.cooldownUntil);
  const cooling = rotated.filter((u) => now < u.cooldownUntil);
  const server = String(query.server || '').toLowerCase();
  // 网易优先 ChKSz（会员/高音质解析），QQ 优先标准 Meting；失败后仍交叉兜底。
  const preferredStyle = server === 'netease' ? 'chksz' : (server === 'tencent' ? 'meting' : '');
  if (!preferredStyle) return [...healthy, ...cooling];
  return [
    ...healthy.filter((upstream) => upstream.style === preferredStyle),
    ...healthy.filter((upstream) => upstream.style !== preferredStyle),
    ...cooling.filter((upstream) => upstream.style === preferredStyle),
    ...cooling.filter((upstream) => upstream.style !== preferredStyle),
  ];
}

async function requestUpstream(upstream, query, options, timeoutMs) {
  let lastError;
  for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      const response = upstream.style === 'chksz'
        ? await fetchChksz(upstream.base, query, timeoutMs, upstream.auth)
        : await fetchMeting(buildUpstreamUrl(upstream, query), options, timeoutMs);
      // 网络抖动和 5xx 快速重试一次；4xx 多为鉴权/参数问题，直接交给切换逻辑。
      if (response.status >= 500 && attempt + 1 < UPSTREAM_ATTEMPTS) continue;
      return response;
    } catch (err) {
      lastError = err;
      const status = Number(err?.status || 0);
      const retryable = !status || status >= 500;
      if (!retryable || attempt + 1 >= UPSTREAM_ATTEMPTS) throw err;
    }
  }
  throw lastError || new Error('音源请求失败');
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

  const candidates = orderedUpstreams(query);
  if (candidates.length === 0) {
    throw new Error('所有 Meting 上游均已禁用');
  }

  const isSearch = String(query?.type || '') === 'search';
  const isUrl = String(query?.type || '') === 'url';
  let lastError = null;
  let emptySearchResponse = null;
  let emptyUrlResponse = null;
  for (const upstream of candidates) {
    try {
      const response = await requestUpstream(upstream, query, options, timeoutMs);
      // 404 视为正常的“歌曲不存在”业务结果；其余 4xx/5xx 视为上游故障并触发切换
      if (response.status >= 400 && response.status !== 404) {
        markFailure(upstream, `上游返回 ${response.status}`);
        lastError = new Error(`Meting 上游返回 ${response.status}（${upstream.base}）`);
        continue;
      }
      markSuccess(upstream);
      // VIP/付费歌曲在部分标准 Meting 上游会返回 HTTP 200，但正文为空、null
      // 或空数组。它不是可播放结果，应继续尝试 ChKSz 等后续上游。
      if (isUrl && response.status === 200) {
        try {
          const text = typeof response.clone === 'function' ? await response.clone().text() : await response.text();
          const normalized = String(text || '').trim().replace(/^['"]|['"]$/g, '').trim();
          if (!normalized || normalized === 'null' || normalized === '[]' || normalized === '{}') {
            emptyUrlResponse = response;
            continue;
          }
        } catch {
          // 无法读取时按原响应返回，交由调用方处理
        }
      }
      // 搜索返回空数组（上游临时限流/曲库缺失时常见）：不算失败，但换下一个上游再试；
      // 全部为空才把空结果返回给调用方（response.text 为缓冲实现，可重复读取）
      if (isSearch && response.status === 200) {
        try {
          const text = typeof response.clone === 'function' ? await response.clone().text() : await response.text();
          const data = JSON.parse(text);
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
  if (emptyUrlResponse) return emptyUrlResponse;
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
      ? await fetchChksz(upstream.base, PROBE_QUERY, PROBE_TIMEOUT_MS, upstream.auth)
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
  if (HEALTH_PROBE_INTERVAL_MS <= 0 || probeTimer) return;
  probeTimer = setInterval(() => {
    // 上游列表由管理后台运行时配置，每个周期重新同步；禁用的上游不探测
    syncUpstreams();
    probeTick += 1;
    const now = Date.now();
    for (const upstream of upstreams) {
      if (upstream.disabled) continue;
      const unhealthy = now < upstream.cooldownUntil;
      if (unhealthy || probeTick % HEALTHY_PROBE_EVERY_N_TICKS === 0) {
        void probeUpstream(upstream);
      }
    }
  }, HEALTH_PROBE_INTERVAL_MS);
  probeTimer.unref();
  console.log(`🩺 Meting 健康探测已启动（间隔 ${HEALTH_PROBE_INTERVAL_MS / 1000}s）`);
}
