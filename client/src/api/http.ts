import { buildApiSignHeaders, canonicalApiQuery, needsApiSign } from '../lib/apiSign';
import { ensureSessionBootstrap } from '../lib/sessionBootstrap';

const DEFAULT_TIMEOUT_MS = 10000;

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return `${input.pathname}${input.search}`;
  return input.url;
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
  const initWithCreds: RequestInit = {
    credentials: 'include',
    ...init,
  };

  if (needsApiSign(url)) {
    await ensureSessionBootstrap();
    const parsed = new URL(url, window.location.origin);
    const method = (init.method || 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? init.body : '';
    const signHeaders = await buildApiSignHeaders(
      method,
      parsed.pathname,
      canonicalApiQuery(parsed.searchParams),
      body,
    );
    initWithCreds.headers = mergeHeaders(signHeaders, init.headers);
  }

  try {
    return await fetch(input, { ...initWithCreds, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}
