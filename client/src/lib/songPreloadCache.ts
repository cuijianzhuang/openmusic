import { getSongUrl, getTrackKey } from '../api/music';
import type { QueueItem } from '../types';
import { isMobileDevice } from './audioUnlock';

const MAX_URL_CACHE = 24;
const DEFAULT_PREFETCH_COUNT = 2;
const URL_CACHE_STORAGE_KEY = 'openmusic:song-url-cache';

const urlCache = loadUrlCacheFromStorage();
const pendingFetches = new Map<string, Promise<string | null>>();

function loadUrlCacheFromStorage(): Map<string, string> {
  try {
    const raw = sessionStorage.getItem(URL_CACHE_STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function persistUrlCacheToStorage() {
  try {
    const entries = [...urlCache.entries()].slice(-MAX_URL_CACHE);
    sessionStorage.setItem(URL_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // sessionStorage may be unavailable.
  }
}

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function trimUrlCache() {
  while (urlCache.size > MAX_URL_CACHE) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    urlCache.delete(oldest);
  }
  persistUrlCacheToStorage();
}

async function fetchSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  options: { refresh?: boolean } = {},
): Promise<string | null> {
  const key = trackKeyOf(song);
  if (options.refresh) {
    urlCache.delete(key);
  } else {
    const cached = urlCache.get(key);
    if (cached) return cached;
  }

  const pendingKey = options.refresh ? `${key}:refresh` : key;
  const pending = pendingFetches.get(pendingKey);
  if (pending) return pending;

  const promise = (async () => {
    try {
      let url: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          url = await getSongUrl({
            id: song.id,
            source: song.source || 'netease',
            url: options.refresh ? undefined : song.url,
          });
          break;
        } catch {
          if (attempt === 1) throw new Error('fetch failed');
        }
      }
      if (!url) return null;
      urlCache.set(key, url);
      trimUrlCache();
      return url;
    } catch {
      return null;
    } finally {
      pendingFetches.delete(pendingKey);
    }
  })();

  pendingFetches.set(pendingKey, promise);
  return promise;
}

export function rememberSongUrl(trackKey: string, url: string) {
  urlCache.set(trackKey, url);
  trimUrlCache();
}

export async function resolveSongUrl(
  song: QueueItem,
  options: { refresh?: boolean } = {},
): Promise<string> {
  const url = await fetchSongUrl(song, options);
  if (!url) throw new Error('empty url');
  return url;
}

/** 加入房间后立即预取当前歌曲 URL，缩短刷新后的加载等待 */
export function prefetchCurrentSong(song: QueueItem | null | undefined) {
  if (!song) return;
  void fetchSongUrl(song);
}

export function prefetchQueueSongs(
  queue: QueueItem[],
  options: { count?: number } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const targets = queue.slice(0, isMobileDevice() ? 1 : count);

  for (const song of targets) {
    void fetchSongUrl(song);
  }
}
