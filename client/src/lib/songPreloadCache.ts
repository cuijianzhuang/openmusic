import { getSongUrl, getTrackKey } from '../api/music';
import { getRoomPlaybackQuality } from '../api/music/quality';
import type { QueueItem } from '../types';
import { isMobileDevice } from './audioUnlock';

const MAX_URL_CACHE = 24;
const DEFAULT_PREFETCH_COUNT = 2;
const URL_CACHE_STORAGE_KEY = 'openmusic:song-url-cache';

const urlCache = loadUrlCacheFromStorage();
const pendingFetches = new Map<string, Promise<string | null>>();
const sourceErrorKeys = new Set<string>();
const sourceErrorListeners = new Set<() => void>();

function notifySourceErrors() {
  sourceErrorListeners.forEach((listener) => listener());
}

export function subscribeSourceErrors(listener: () => void) {
  sourceErrorListeners.add(listener);
  return () => {
    sourceErrorListeners.delete(listener);
  };
}

export function isTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): boolean {
  return sourceErrorKeys.has(trackKeyOf(song));
}

function markTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  if (sourceErrorKeys.has(key)) return;
  sourceErrorKeys.add(key);
  notifySourceErrors();
}

function clearTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const key = trackKeyOf(song);
  if (!sourceErrorKeys.delete(key)) return;
  notifySourceErrors();
}

/** 移除已不在播放列表中的源错误标记，避免 Set 无限增长 */
export function pruneSourceErrors(activeSongs: Array<Pick<QueueItem, 'queueId' | 'id' | 'source'>>) {
  const activeKeys = new Set(activeSongs.map(trackKeyOf));
  let changed = false;
  for (const key of sourceErrorKeys) {
    if (!activeKeys.has(key)) {
      sourceErrorKeys.delete(key);
      changed = true;
    }
  }
  if (changed) notifySourceErrors();
}

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

function urlCacheKey(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const source = song.source || 'netease';
  const quality = getRoomPlaybackQuality(source);
  return `${trackKeyOf(song)}:${quality || 'default'}`;
}

export function clearSongUrlCache() {
  urlCache.clear();
  pendingFetches.clear();
  try {
    sessionStorage.removeItem(URL_CACHE_STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable.
  }
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
  const key = urlCacheKey(song);
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
      try {
        url = await getSongUrl({
          id: song.id,
          source: song.source || 'netease',
          url: options.refresh ? undefined : song.url,
        });
      } catch {
        // 酷狗等源若详情已确认 url 为空，重试同一接口无意义
        markTrackSourceError(song);
        return null;
      }
      if (!url) {
        markTrackSourceError(song);
        return null;
      }
      clearTrackSourceError(song);
      urlCache.set(key, url);
      trimUrlCache();
      return url;
    } catch {
      markTrackSourceError(song);
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
  options: { count?: number; current?: QueueItem | null } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const targets = queue.slice(0, isMobileDevice() ? 1 : count);

  if (options.current) {
    pruneSourceErrors([options.current, ...queue]);
  } else {
    pruneSourceErrors(queue);
  }

  for (const song of targets) {
    void fetchSongUrl(song);
  }
}
