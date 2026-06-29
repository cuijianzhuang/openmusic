export type CoverSize = 'tiny' | 'thumb' | 'medium' | 'full';

export const COVER_SIZE_PX: Record<Exclude<CoverSize, 'full'>, number> = {
  tiny: 64,
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

function appendMetingThumbParam(url: string, px: number): string {
  const idx = url.indexOf('?');
  const params = new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
  if (params.get('type') !== 'pic') return url;
  params.set('size', String(px));
  return `${url.split('?')[0]}?${params.toString()}`;
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

function resizeNeteaseCover(url: string, px: number): string {
  if (!/music\.126\.net|126\.net/i.test(url)) return url;
  if (/param=\d+y\d+/i.test(url)) {
    return url.replace(/param=\d+y\d+/gi, `param=${px}y${px}`);
  }
  return setUrlSearchParam(url, 'param', `${px}y${px}`);
}

function resizeQqCover(url: string, px: number): string {
  if (!/\.gtimg\.com\/music\/photo_new\//i.test(url) && !/y\.qq\.com\/music\/photo_new\//i.test(url)) {
    return url;
  }
  const code = px <= 58 ? 'T001R' : px <= 300 ? 'T002R' : 'T003R';
  if (/T00\dR/i.test(url)) return url.replace(/T00\dR/i, code);
  if (/\d+x\d+/.test(url)) return url.replace(/\d+x\d+/g, `${px}x${px}`);
  return url;
}

function resizeKugouCover(url: string, px: number): string {
  if (!/kugou\.com/i.test(url)) return url;
  const bucket = px <= 64 ? 64 : px <= 120 ? 120 : px <= 240 ? 240 : 400;
  const resized = url.replace(/\/(\d+)\//, `/${bucket}/`);
  if (resized !== url) return resized;
  return url.replace(/\/(480|400|240|200|150)\//, `/${bucket}/`);
}

function resizeDirectCoverUrl(url: string, px: number): string {
  if (!url) return url;

  let next = url;
  next = resizeNeteaseCover(next, px);
  if (next !== url) return next;

  next = resizeQqCover(url, px);
  if (next !== url) return next;

  next = resizeKugouCover(url, px);
  if (next !== url) return next;

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

  if (url.startsWith('/api/meting')) {
    return appendMetingThumbParam(url, px);
  }

  if (url.includes('/api/media-proxy')) {
    return resizeMediaProxyUrl(url, px);
  }

  return resizeDirectCoverUrl(url, px);
}

export function getFallbackCoverUrl(): string {
  return FALLBACK_COVER;
}

export function getCoverPixelSize(size: CoverSize): number | undefined {
  if (size === 'full') return undefined;
  return COVER_SIZE_PX[size];
}
