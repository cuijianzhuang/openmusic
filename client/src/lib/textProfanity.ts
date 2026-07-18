import { getChatTextGateKey } from './sessionBootstrap';
import { getClientId } from './clientId';

const PROFANITY_URL = 'https://uapis.cn/api/v1/text/profanitycheck';
const CHECK_TIMEOUT_MS = 3500;
const PASS_TTL_SEC = 90;
const PASS_PREFIX = 'v1';
const QUOTA_STORAGE_KEY = 'openmusic:uapis-profanity-quota';
/** 剩余积分 ≤ 该值时停用前端检测，全部交给后端兜底（访客每月 1500 积分，各接口共享） */
const REMOTE_QUOTA_RESERVE = 50;
const VERDICT_CACHE_TTL_MS = 10 * 60 * 1000;
const NETWORK_BACKOFF_MS = 60 * 1000;
const SERVICE_BACKOFF_MS = 5 * 60 * 1000;

type QuotaState = {
  disabledUntil: number;
};

type CachedVerdict = {
  blocked: boolean;
  expiresAt: number;
};

const verdictCache = new Map<string, CachedVerdict>();
const inflightChecks = new Map<string, Promise<boolean | null>>();

export type TextProfanityResult =
  | { ok: true; pass?: string }
  | { ok: false; error: string };

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256Base64Url(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readQuotaState(): QuotaState {
  try {
    const raw = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) || 'null') as Partial<QuotaState> | null;
    return { disabledUntil: Math.max(0, Number(raw?.disabledUntil) || 0) };
  } catch {
    return { disabledUntil: 0 };
  }
}

function writeQuotaState(state: QuotaState): void {
  try {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 不可用时仍可请求；服务端始终保留兜底检测。
  }
}

function clientChecksAllowed(): boolean {
  return Date.now() >= readQuotaState().disabledUntil;
}

function backoffClientChecks(durationMs: number): void {
  const state = readQuotaState();
  state.disabledUntil = Math.max(state.disabledUntil, Date.now() + durationMs);
  writeQuotaState(state);
}

function syncRemoteQuota(response: Response): void {
  // uapis 的 RateLimit 头会返回剩余积分，例：
  // "visitor-rate";r=3,"visitor-quota";r=1484;uapi-unit="credits";t=1158710
  const rateLimit = response.headers.get('RateLimit') || '';
  const quotaSegment = rateLimit
    .split(',')
    .find((segment) => segment.toLowerCase().includes('visitor-quota'));
  if (!quotaSegment) return;
  const remaining = Number(quotaSegment.match(/;r=(\d+)/i)?.[1]);
  const resetSec = Number(quotaSegment.match(/;t=(\d+)/i)?.[1]);
  // 以上游返回的剩余积分为准；低于保留值就停用，等待积分重置
  if (Number.isFinite(remaining) && remaining <= REMOTE_QUOTA_RESERVE) {
    backoffClientChecks(
      Number.isFinite(resetSec) && resetSec > 0
        ? Math.min(resetSec * 1000, 32 * 24 * 60 * 60 * 1000)
        : SERVICE_BACKOFF_MS,
    );
  }
}

function getCachedVerdict(textHash: string): boolean | null {
  const cached = verdictCache.get(textHash);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    verdictCache.delete(textHash);
    return null;
  }
  return cached.blocked;
}

function cacheVerdict(textHash: string, blocked: boolean): void {
  verdictCache.set(textHash, {
    blocked,
    expiresAt: Date.now() + VERDICT_CACHE_TTL_MS,
  });
  if (verdictCache.size > 100) {
    const oldest = verdictCache.keys().next().value as string | undefined;
    if (oldest) verdictCache.delete(oldest);
  }
}

async function requestProfanityVerdict(normalized: string, textHash: string): Promise<boolean | null> {
  const cached = getCachedVerdict(textHash);
  if (cached !== null) return cached;
  const existing = inflightChecks.get(textHash);
  if (existing) return existing;
  if (!clientChecksAllowed()) return null;

  const request = (async (): Promise<boolean | null> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(PROFANITY_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: normalized }),
        cache: 'no-store',
      });
      syncRemoteQuota(response);

      if (!response.ok) {
        const retryAfterSec = Number(response.headers.get('Retry-After'));
        backoffClientChecks(
          response.status === 429
            ? (Number.isFinite(retryAfterSec) && retryAfterSec > 0
                ? retryAfterSec * 1000
                : SERVICE_BACKOFF_MS)
            : SERVICE_BACKOFF_MS,
        );
        return null;
      }

      const data = await response.json() as {
        status?: string;
        forbidden_words?: unknown;
      };
      const forbiddenWords = Array.isArray(data.forbidden_words)
        ? data.forbidden_words.map((word) => String(word || '').trim()).filter(Boolean)
        : [];
      const status = String(data.status || '').toLowerCase();
      if (status !== 'ok' && status !== 'forbidden') return null;

      const blocked = status === 'forbidden' || forbiddenWords.length > 0;
      cacheVerdict(textHash, blocked);
      return blocked;
    } catch {
      backoffClientChecks(NETWORK_BACKOFF_MS);
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  })().finally(() => {
    inflightChecks.delete(textHash);
  });

  inflightChecks.set(textHash, request);
  return request;
}

/** 用 bootstrap 下发的 chatTextGateKey 签发密令（绑定当前用户与原文） */
export async function mintChatTextGatePass(
  text: string,
  gateKey: string,
  userId: string,
): Promise<string | undefined> {
  const key = String(gateKey || '').trim();
  const uid = String(userId || '').trim();
  const normalized = String(text || '');
  if (!key || !uid || !normalized) return undefined;

  const ts = Math.floor(Date.now() / 1000);
  const textHash = await sha256Hex(normalized);
  const payload = [PASS_PREFIX, uid, textHash, String(ts)].join('\n');
  const sign = await hmacSha256Base64Url(key, payload);
  return `${ts}.${textHash}.${sign}`;
}

/**
 * 前端快速敏感词检测（uapis）。通过后签发密令供后端跳过慢速检测。
 * @see https://uapis.cn/api/v1/text/profanitycheck
 */
export async function checkTextProfanity(
  text: string,
  options: { userId?: string | null } = {},
): Promise<TextProfanityResult> {
  const normalized = String(text || '').trim();
  if (!normalized) return { ok: true };

  try {
    const textHash = await sha256Hex(normalized);
    const blocked = await requestProfanityVerdict(normalized, textHash);
    // null 表示配额不足、限流、超时或响应异常：不签密令，后端自动兜底。
    if (blocked === null) return { ok: true };
    if (blocked) {
      return { ok: false, error: '消息包含敏感词，请修改后发送' };
    }

    const userId = String(options.userId || getClientId() || '').trim();
    const gateKey = getChatTextGateKey();
    const pass = gateKey && userId
      ? await mintChatTextGatePass(normalized, gateKey, userId)
      : undefined;
    return { ok: true, pass };
  } catch {
    // 任意前端异常均不签密令，走服务端兜底检测。
    return { ok: true };
  }
}

export const CHAT_TEXT_GATE_PASS_TTL_SEC = PASS_TTL_SEC;
