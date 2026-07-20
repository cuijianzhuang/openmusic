import { getRuntimeConfig } from './runtimeConfig.js';

/**
 * LrcAPI（https://docs.lrc.cx）歌词兜底：支持配置多个上游做负载均衡。
 * 与 metingUpstream.js 同构：轮询调度 + 故障 60s 冷却自动切换。
 */

const FAIL_COOLDOWN_MS = 60_000;
const LRC_TIMELINE_RE = /\[\d{2}:\d{2}/;

let upstreams = [];
let upstreamSignature = '';
let rrCursor = 0;

function trimTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function syncUpstreams() {
  const signature = getRuntimeConfig().lrcapiUrl || '';
  if (signature === upstreamSignature) return;

  const rawUrls = signature.split(',').map((s) => trimTrailingSlash(s)).filter(Boolean);
  const previous = new Map(upstreams.map((u) => [u.base, u]));
  upstreams = rawUrls.map((base) => {
    const old = previous.get(base);
    return {
      base,
      cooldownUntil: old?.cooldownUntil || 0,
      okCount: old?.okCount || 0,
      failCount: old?.failCount || 0,
      lastError: old?.lastError || '',
    };
  });
  upstreamSignature = signature;
  rrCursor = 0;
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

function markFailure(upstream, message) {
  upstream.failCount += 1;
  upstream.cooldownUntil = Date.now() + FAIL_COOLDOWN_MS;
  upstream.lastError = message;
}

function markSuccess(upstream) {
  upstream.okCount += 1;
  upstream.cooldownUntil = 0;
  upstream.lastError = '';
}

function isUsableLrcText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (/暂无歌词|无歌词|not found|404/i.test(trimmed)) return false;
  return LRC_TIMELINE_RE.test(trimmed);
}

export function getLrcapiUpstreamStatus() {
  syncUpstreams();
  const now = Date.now();
  return upstreams.map((u) => ({
    url: u.base,
    healthy: now >= u.cooldownUntil,
    cooldownRemainingSec: Math.max(0, Math.ceil((u.cooldownUntil - now) / 1000)),
    okCount: u.okCount,
    failCount: u.failCount,
    lastError: u.lastError,
  }));
}

/**
 * 按 标题/歌手/专辑 请求 LrcAPI，多上游轮询负载均衡；
 * 请求失败或响应非可用 LRC 时切换下一个上游，全部失败返回空串（调用方继续走下一级兜底）。
 */
export async function fetchLrcapiLyrics({ title, artist, album }, timeoutMs = 8000) {
  syncUpstreams();
  if (upstreams.length === 0) return '';

  const params = new URLSearchParams({ title });
  if (artist) params.set('artist', artist);
  if (album) params.set('album', album);

  for (const upstream of orderedUpstreams()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 旧版 /lyrics 端点兼容公共实例与新老自部署版本
      const response = await fetch(`${upstream.base}/lyrics?${params}`, { signal: controller.signal });
      if (!response.ok) {
        markFailure(upstream, `上游返回 ${response.status}`);
        continue;
      }
      const text = await response.text();
      if (!isUsableLrcText(text)) {
        // 未命中/空歌词是正常业务结果，不算上游故障，但仍尝试下一个上游可能有更好的匹配
        markSuccess(upstream);
        continue;
      }
      markSuccess(upstream);
      return text;
    } catch (err) {
      markFailure(upstream, err?.message || 'fetch failed');
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}
