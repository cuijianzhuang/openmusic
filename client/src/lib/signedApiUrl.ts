import { useEffect, useState } from 'react';
import { buildApiSignHeaders, canonicalApiQuery, needsApiSign } from './apiSign';
import { ensureSessionBootstrap } from './sessionBootstrap';

const SIGN_QUERY_KEYS = ['om_ts', 'om_nonce', 'om_sign'] as const;
/**
 * 去掉已有签名参数。
 * - 同源 /api 相对路径：返回 pathname+search
 * - 外链（网易 CDN 等）：原样返回，绝不能裁掉 origin
 */
export function stripApiSignParams(url: string): string {
  if (!url) return url;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, origin);
    const hadSign = SIGN_QUERY_KEYS.some((key) => parsed.searchParams.has(key));
    for (const key of SIGN_QUERY_KEYS) parsed.searchParams.delete(key);

    // 外链或非 /api：保留完整绝对地址（或原样）
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/api/')) {
      if (!hadSign && /^https?:\/\//i.test(url)) return url;
      return parsed.href;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

/**
 * 为同源 /api URL 附加 query 签名。
 * 媒体路径每次重新颁发；外链直链不做任何改写。
 */
export async function signApiUrl(relativeUrl: string, options?: { force?: boolean }): Promise<string> {
  if (!needsApiSign(relativeUrl)) return relativeUrl;

  const cacheKey = stripApiSignParams(relativeUrl);
  // 普通 GET 的 nonce 会被服务端消费，不能复用签名 URL；媒体也换发以刷新时间窗口。
  void options;

  await ensureSessionBootstrap();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const parsed = new URL(cacheKey, origin);
  const query = canonicalApiQuery(parsed.searchParams);
  const headers = await buildApiSignHeaders('GET', parsed.pathname, query, '');
  if (!headers['X-OM-Sign']) return cacheKey;

  parsed.searchParams.set('om_ts', headers['X-OM-Ts']);
  parsed.searchParams.set('om_nonce', headers['X-OM-Nonce']);
  parsed.searchParams.set('om_sign', headers['X-OM-Sign']);
  const signed = `${parsed.pathname}${parsed.search}${parsed.hash}`;

  return signed;
}

/** 强制换发新签名；非 /api 直链原样返回 */
export async function refreshSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!needsApiSign(url)) return url;
  return signApiUrl(url, { force: true });
}

export async function resolveSignedApiUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!needsApiSign(url)) return url;
  return signApiUrl(url);
}

/** 为 `<img>` / `<audio>` 等同源媒体地址异步附加 query 签名 */
export function useSignedApiUrl(url: string | null | undefined): string | null {
  const target = url ?? null;
  const [state, setState] = useState<{ url: string | null; signed: string | null }>(() => ({
    url: target,
    signed: target && !needsApiSign(target) ? target : null,
  }));

  useEffect(() => {
    if (!target) {
      setState({ url: null, signed: null });
      return;
    }
    if (!needsApiSign(target)) {
      setState({ url: target, signed: target });
      return;
    }

    let cancelled = false;
    void signApiUrl(target).then((next) => {
      if (!cancelled) setState({ url: target, signed: next });
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // 签名是跟着具体地址走的：切歌后新签名没算出来之前交出旧签名，
  // 拿到的会是上一首的图，调用方还可能把它缓存到新歌的 key 上。
  return state.url === target ? state.signed : null;
}
