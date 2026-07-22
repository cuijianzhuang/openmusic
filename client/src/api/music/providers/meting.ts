import type { MusicProvider, SearchResult } from '../types';
import type { MusicSource } from '../../../types';
import { fetchWithTimeout } from '../../http';
import { isSourceUnavailableMessage, SourceUnavailableError } from '../../../lib/audioPlaybackError';

const API_BASE = '/api/meting';

function parseMetingMediaQuery(url: string): { server: MusicSource; id: string; type: 'url' | 'lrc' | 'pic' } | null {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const type = parsed.searchParams.get('type');
    if (type !== 'url' && type !== 'lrc' && type !== 'pic') return null;
    const server = parsed.searchParams.get('server');
    const id = parsed.searchParams.get('id');
    if (!server || !id) return null;
    if (server !== 'netease' && server !== 'tencent') return null;
    return { server, id, type };
  } catch {
    return null;
  }
}

/** Meting 搜索结果里常带 127.0.0.1/api?type=url，需经 /api/meting 二次解析 */
function isMetingResolverUrl(url?: string): boolean {
  if (!url?.startsWith('http')) return false;
  const query = parseMetingMediaQuery(url);
  if (!query) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost'
      || host === '127.0.0.1'
      || host.endsWith('.local')
      || parsed.pathname.includes('/api');
  } catch {
    return false;
  }
}

/**
 * 网易云「外链直连」假地址：上游拿不到真实 CDN 时常回落成
 * music.163.com/song/media/outer/url?id=xxx.mp3，实际访问 404，不可播。
 */
function isNeteaseOuterMediaUrl(url?: string): boolean {
  if (!url?.startsWith('http')) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'music.163.com' && host !== 'www.music.163.com') return false;
    return /\/song\/media\/outer\/url/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isDirectPlayableUrl(url?: string): boolean {
  return Boolean(url?.startsWith('http') && !isMetingResolverUrl(url) && !isNeteaseOuterMediaUrl(url));
}

function normalizeMetingTextUrl(raw: string): string {
  const text = raw.trim();
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function parseMetingErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as { error?: unknown };
      if (typeof data.error === 'string') return data.error.trim();
    } catch {
      // fall through
    }
  }
  return trimmed;
}

function throwIfSourceUnavailable(message: string): void {
  if (isSourceUnavailableMessage(message)) {
    throw new SourceUnavailableError(message);
  }
}

async function metingFetch<T>(server: MusicSource, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ server, ...params });
  const res = await fetchWithTimeout(`${API_BASE}?${query}`);
  if (!res.ok) throw new Error('API 请求失败');
  return res.json();
}

async function metingText(server: MusicSource, params: Record<string, string>): Promise<string> {
  const query = new URLSearchParams({ server, ...params });
  const res = await fetchWithTimeout(`${API_BASE}?${query}`, { redirect: 'manual' });
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('Location') || res.headers.get('location') || '';
    if (location) return location;
  }
  if (!res.ok) throw new Error('API 请求失败');
  return res.text();
}

function extractIdFromUrl(url: string): string {
  try {
    const match = url.match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function normalizeSong(raw: Record<string, unknown>, source: MusicSource): SearchResult {
  const artist = raw.artist ?? raw.author;
  const artistStr = Array.isArray(artist)
    ? (artist as Array<{ name?: string }>).map((a) => a.name).join(' / ')
    : String(artist || '未知歌手');

  const urlStr = raw.url ? String(raw.url) : '';
  const lrcStr = raw.lrc ? String(raw.lrc) : '';
  const id = String(raw.id || extractIdFromUrl(urlStr) || '');

  return {
    id,
    source,
    name: String(raw.name || raw.title || '未知歌曲'),
    artist: artistStr,
    album: String(raw.album || raw.album_name || ''),
    pic: String(raw.pic || raw.cover || raw.album_pic || ''),
    duration: Number(raw.duration || raw.dt || 0) || undefined,
    url: isDirectPlayableUrl(urlStr) ? urlStr : undefined,
    lrc: lrcStr.startsWith('[') ? lrcStr : undefined,
  };
}

function createMetingProvider(
  source: Extract<MusicSource, 'netease' | 'tencent'>,
  meta: Omit<import('../types').MusicProviderMeta, 'id'>,
): MusicProvider {
  return {
    id: source,
    ...meta,
    async search(keyword) {
      if (!meta.supportsSearch || !keyword.trim()) return [];
      const data = await metingFetch<Record<string, unknown>[]>(source, {
        type: 'search',
        id: keyword.trim(),
      });
      if (!Array.isArray(data)) return [];
      return data.map((item) => normalizeSong(item, source)).filter((s) => s.id);
    },
    async getSongById(id) {
      if (!id.trim()) return null;
      const data = await metingFetch<Record<string, unknown> | Record<string, unknown>[]>(source, {
        type: 'song',
        id: id.trim(),
      });
      const raw = Array.isArray(data) ? data[0] : data;
      if (!raw) return null;
      const song = normalizeSong(raw, source);
      return song.id ? song : null;
    },
    async getSongUrl(song, quality) {
      if (isDirectPlayableUrl(song.url)) return { url: song.url! };
      const query = new URLSearchParams({ server: song.source, type: 'url', id: song.id });
      if (quality) query.set('quality', quality);
      const res = await fetchWithTimeout(`${API_BASE}?${query}`, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        const location = normalizeMetingTextUrl(res.headers.get('Location') || res.headers.get('location') || '');
        if (isDirectPlayableUrl(location)) return { url: location };
      }
      const text = (await res.text()).trim();
      if (!res.ok) {
        const errMsg = parseMetingErrorMessage(text);
        throwIfSourceUnavailable(errMsg);
        throw new Error(errMsg || 'API 请求失败');
      }
      if (text.startsWith('{')) {
        try {
          const data = JSON.parse(text) as { url?: unknown; quality?: unknown; error?: unknown };
          const errMsg = typeof data.error === 'string' ? data.error.trim() : '';
          throwIfSourceUnavailable(errMsg);
          const url = normalizeMetingTextUrl(String(data.url || ''));
          if (isDirectPlayableUrl(url)) {
            const qualityLabel = String(data.quality || '').trim() || undefined;
            return { url, qualityLabel };
          }
        } catch (error) {
          if (error instanceof SourceUnavailableError) throw error;
          // fall through
        }
      }
      const url = normalizeMetingTextUrl(text);
      if (isDirectPlayableUrl(url)) return { url };
      throw new SourceUnavailableError('no url');
    },
    async getLyrics(song) {
      if (song.lrc?.startsWith('[')) return song.lrc;
      return metingText(song.source, { type: 'lrc', id: song.id });
    },
    getCoverUrl(song) {
      if (song.pic) return song.pic;
      return `${API_BASE}?server=${song.source}&type=pic&id=${song.id}`;
    },
  };
}

export const neteaseProvider = createMetingProvider('netease', {
  name: '红点',
  shortName: '红点',
  color: '#ec4141',
  supportsSearch: true,
  supportsIdLookup: true,
});

export const tencentProvider = createMetingProvider('tencent', {
  name: '绿点',
  shortName: '绿点',
  color: '#31c27c',
  supportsSearch: true,
  supportsIdLookup: false,
});

export async function metingSearchPlaylists(
  server: Extract<MusicSource, 'netease' | 'tencent'>,
  keyword: string,
): Promise<Record<string, unknown>[]> {
  if (!keyword.trim()) return [];
  const data = await metingFetch<Record<string, unknown>[]>(server, {
    type: 'search_playlist',
    id: keyword.trim(),
  });
  return Array.isArray(data) ? data : [];
}
