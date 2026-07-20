const PROFANITY_URL = 'https://uapis.cn/api/v1/text/profanitycheck';
const CHECK_TIMEOUT_MS = 3500;
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
  forbiddenWords: string[];
  expiresAt: number;
};

const verdictCache = new Map<string, CachedVerdict>();
const inflightChecks = new Map<string, Promise<ProfanityVerdict>>();

export type TextProfanityResult =
  | { ok: true }
  | { ok: false; error: string };

type ProfanityVerdict =
  | { kind: 'pass' }
  | { kind: 'blocked'; forbiddenWords: string[] }
  | { kind: 'skip' };

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const cleaned = String(word || '').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function formatBlockedError(forbiddenWords: string[]): string {
  const words = uniqueWords(forbiddenWords);
  if (words.length === 0) return '消息包含敏感词，请修改后发送';
  return `消息包含敏感词（${words.join('、')}），请修改后发送`;
}

async function sha256Hex(text: string): Promise<string> {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

function getCachedVerdict(textHash: string): ProfanityVerdict | null {
  const cached = verdictCache.get(textHash);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    verdictCache.delete(textHash);
    return null;
  }
  return cached.blocked
    ? { kind: 'blocked', forbiddenWords: cached.forbiddenWords }
    : { kind: 'pass' };
}

function cacheVerdict(textHash: string, blocked: boolean, forbiddenWords: string[] = []): void {
  verdictCache.set(textHash, {
    blocked,
    forbiddenWords: uniqueWords(forbiddenWords),
    expiresAt: Date.now() + VERDICT_CACHE_TTL_MS,
  });
  if (verdictCache.size > 100) {
    const oldest = verdictCache.keys().next().value as string | undefined;
    if (oldest) verdictCache.delete(oldest);
  }
}

async function requestProfanityVerdict(normalized: string, textHash: string): Promise<ProfanityVerdict> {
  const cached = getCachedVerdict(textHash);
  if (cached) return cached;
  const existing = inflightChecks.get(textHash);
  if (existing) return existing;
  if (!clientChecksAllowed()) return { kind: 'skip' };

  const request = (async (): Promise<ProfanityVerdict> => {
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
        return { kind: 'skip' };
      }

      const data = await response.json() as {
        status?: string;
        forbidden_words?: unknown;
      };
      const forbiddenWords = uniqueWords(
        Array.isArray(data.forbidden_words)
          ? data.forbidden_words.map((word) => String(word || '').trim())
          : [],
      );
      const status = String(data.status || '').toLowerCase();
      if (status !== 'ok' && status !== 'forbidden') return { kind: 'skip' };

      const blocked = status === 'forbidden' || forbiddenWords.length > 0;
      cacheVerdict(textHash, blocked, forbiddenWords);
      return blocked
        ? { kind: 'blocked', forbiddenWords }
        : { kind: 'pass' };
    } catch {
      backoffClientChecks(NETWORK_BACKOFF_MS);
      return { kind: 'skip' };
    } finally {
      window.clearTimeout(timer);
    }
  })().finally(() => {
    inflightChecks.delete(textHash);
  });

  inflightChecks.set(textHash, request);
  return request;
}

/**
 * 前端快速敏感词检测（uapis），仅用于即时提示；服务端仍会权威复检。
 * @see https://uapis.cn/api/v1/text/profanitycheck
 */
export async function checkTextProfanity(
  text: string,
  _options: { userId?: string | null } = {},
): Promise<TextProfanityResult> {
  const normalized = String(text || '').trim();
  if (!normalized) return { ok: true };

  try {
    const textHash = await sha256Hex(normalized);
    const verdict = await requestProfanityVerdict(normalized, textHash);
    // skip 表示配额不足、限流、超时或响应异常：不签密令，后端自动兜底。
    if (verdict.kind === 'skip') return { ok: true };
    if (verdict.kind === 'blocked') {
      return { ok: false, error: formatBlockedError(verdict.forbiddenWords) };
    }

    return { ok: true };
  } catch {
    // 任意前端异常均不签密令，走服务端兜底检测。
    return { ok: true };
  }
}
