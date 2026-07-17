import { useEffect, useState } from 'react';
import { buildApiSignHeaders, canonicalApiQuery, needsApiSign } from './apiSign';
import { ensureSessionBootstrap } from './sessionBootstrap';

const SIGNED_URL_CACHE_TTL_MS = 4 * 60 * 1000;
const signedUrlCache = new Map<string, { url: string; expires: number }>();

export async function signApiUrl(relativeUrl: string): Promise<string> {
  if (!needsApiSign(relativeUrl)) return relativeUrl;

  const cached = signedUrlCache.get(relativeUrl);
  if (cached && cached.expires > Date.now()) return cached.url;

  await ensureSessionBootstrap();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(relativeUrl, origin);
  const query = canonicalApiQuery(parsed.searchParams);
  const headers = await buildApiSignHeaders('GET', parsed.pathname, query, '');
  if (!headers['X-OM-Sign']) return relativeUrl;

  parsed.searchParams.set('om_ts', headers['X-OM-Ts']);
  parsed.searchParams.set('om_nonce', headers['X-OM-Nonce']);
  parsed.searchParams.set('om_sign', headers['X-OM-Sign']);
  const signed = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  signedUrlCache.set(relativeUrl, { url: signed, expires: Date.now() + SIGNED_URL_CACHE_TTL_MS });
  return signed;
}

export async function resolveSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!needsApiSign(url)) return url;
  return signApiUrl(url);
}

/** 为 `<img>` / `<audio>` 等同源媒体地址异步附加 query 签名 */
export function useSignedApiUrl(url: string | null | undefined): string | null {
  const [signed, setSigned] = useState<string | null>(() => {
    if (!url) return null;
    return needsApiSign(url) ? null : url;
  });

  useEffect(() => {
    if (!url) {
      setSigned(null);
      return;
    }
    if (!needsApiSign(url)) {
      setSigned(url);
      return;
    }

    let cancelled = false;
    void signApiUrl(url).then((next) => {
      if (!cancelled) setSigned(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return signed;
}
