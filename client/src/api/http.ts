import { buildApiSignHeaders, canonicalApiQuery, needsApiSign } from '../lib/apiSign';
import { ensureSessionBootstrap } from '../lib/sessionBootstrap';

const DEFAULT_TIMEOUT_MS = 10000;

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isSameOriginApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.startsWith('/api/')) return false;
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

function mergeHeaders(
  base: Record<string, string>,
  extra?: HeadersInit,
): HeadersInit {
  if (!extra) return base;
  const merged = new Headers(extra);
  for (const [key, value] of Object.entries(base)) {
    merged.set(key, value);
  }
  return merged;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  const url = resolveRequestUrl(input);
  const sameOriginApi = isSameOriginApiUrl(url);

  // 仅同源 /api 默认带 Cookie；外链（如七牛上传）绝不能 credentials:include，否则 CORS 直接 Failed to fetch
  const initFinal: RequestInit = { ...init };
  if (sameOriginApi && initFinal.credentials === undefined) {
    initFinal.credentials = 'include';
  }

  const method = (init.method || 'GET').toUpperCase();
  if (needsApiSign(url, method) && sameOriginApi) {
    await ensureSessionBootstrap();
    const parsed = new URL(url, window.location.origin);
    const body = typeof init.body === 'string' ? init.body : '';
    const signHeaders = await buildApiSignHeaders(
      method,
      parsed.pathname,
      canonicalApiQuery(parsed.searchParams),
      body,
    );
    initFinal.headers = mergeHeaders(signHeaders, init.headers);
  }

  try {
    return await fetch(input, { ...initFinal, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
