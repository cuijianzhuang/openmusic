export type CoverSize = 'thumb' | 'medium' | 'full';

const COVER_SIZE_PX: Record<Exclude<CoverSize, 'full'>, number> = {
  thumb: 96,
  medium: 320,
};

const FALLBACK_COVER =
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="%23333" width="48" height="48"/><text x="24" y="28" text-anchor="middle" fill="%23666" font-size="16">♪</text></svg>';

function setUrlSearchParam(url: string, key: string, value: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const [base, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    params.set(key, value);
    const next = params.toString();
    return next ? `${base}?${next}` : `${base}?${key}=${encodeURIComponent(value)}`;
  }
}

function resizeMediaProxyUrl(url: string, px: number): string {
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return url;

  const params = new URLSearchParams(url.slice(queryStart + 1));
  const raw = params.get('url');
  if (!raw) return url;

  const inner = decodeURIComponent(raw);
  const resized = resizeDirectCoverUrl(inner, px);
  if (resized === inner) return url;

  params.set('url', resized);
  return `${url.slice(0, queryStart)}?${params.toString()}`;
}

function resizeDirectCoverUrl(url: string, px: number): string {
  if (!url) return url;

  if (/music\.126\.net|126\.net.*\.(jpg|jpeg|png|webp)/i.test(url)) {
    return setUrlSearchParam(url, 'param', `${px}y${px}`);
  }

  if (/\.gtimg\.com|qq\.com.*\.(jpg|jpeg|png|webp)/i.test(url)) {
    if (/\d+x\d+/.test(url)) return url.replace(/\d+x\d+/g, `${px}x${px}`);
  }

  if (/kugou\.com/i.test(url)) {
    const resized = url.replace(/\/(480|400|240|200|150)\//, `/${px}/`);
    if (resized !== url) return resized;
  }

  if (/param=\d+y\d+/i.test(url)) {
    return url.replace(/param=\d+y\d+/gi, `param=${px}y${px}`);
  }

  if (/thumbnail=\d+/i.test(url)) {
    return url.replace(/thumbnail=\d+/gi, `thumbnail=${px}`);
  }

  return url;
}

export function resizeCoverUrl(url: string, size: CoverSize = 'full'): string {
  if (!url || size === 'full') return url;

  const px = COVER_SIZE_PX[size];
  if (url.startsWith('/api/meting')) return url;
  if (url.includes('/api/media-proxy')) return resizeMediaProxyUrl(url, px);

  return resizeDirectCoverUrl(url, px);
}

export function getFallbackCoverUrl(): string {
  return FALLBACK_COVER;
}
