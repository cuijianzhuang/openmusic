import { getSongUrlInfo, getTrackKey, searchSongs } from '../api/music';
import { isHttpsPageContext } from './mediaProxyUrl';
import { shouldProxySongPlaybackUrl } from './roomVisualPreset';
import {
  getLowestQuality,
  getUserPlaybackQuality,
} from '../api/music/quality';
import {
  classifySongUrlFetchError,
  classifySongUrlFetchFailure,
  isBlockedPlaybackUrl,
  type PlaybackErrorClass,
} from './audioPlaybackError';
import {
  isPlaybackQualityLockedToLowest,
  lockPlaybackQualityToLowest,
  resetPlaybackQualityLock,
} from './playbackQualityLock';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import type { MusicSource, QueueItem, RoomState, SearchResult } from '../types';
import { isMobileDevice } from './audioUnlock';

const MAX_URL_CACHE = 24;
const DEFAULT_PREFETCH_COUNT = 2;
const URL_CACHE_STORAGE_KEY = 'openmusic:song-url-cache:v2';

type CachedUrlEntry = { url: string; qualityLabel?: string };

type FetchUrlResult =
  | { ok: true; url: string; qualityLabel?: string }
  | { ok: false; errorClass: PlaybackErrorClass };

const urlCache = loadUrlCacheFromStorage();
const pendingFetches = new Map<string, Promise<FetchUrlResult>>();
const sourceErrorKeys = new Set<string>();
const sourceErrorListeners = new Set<() => void>();
const pendingCrossSourceFallbacks = new Map<string, Promise<string | null>>();
const crossSourceCandidateCache = new Map<string, { expiresAt: number; candidates: SearchResult[] }>();
const CROSS_SOURCE_CACHE_TTL_MS = 10 * 60_000;
const ALL_MUSIC_SOURCES: MusicSource[] = ['netease', 'tencent', 'kugou'];

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

export function clearTrackSourceError(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
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

function loadUrlCacheFromStorage(): Map<string, CachedUrlEntry> {
  try {
    const raw = sessionStorage.getItem(URL_CACHE_STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, CachedUrlEntry | string>;
    const map = new Map<string, CachedUrlEntry>();
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        map.set(key, { url: value });
      } else if (value && typeof value === 'object' && typeof value.url === 'string') {
        map.set(key, {
          url: value.url,
          qualityLabel: typeof value.qualityLabel === 'string' ? value.qualityLabel : undefined,
        });
      }
    }
    return map;
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

function publishActualQuality(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>, qualityLabel?: string) {
  const label = qualityLabel?.trim();
  // 无音质时不写 store：避免预取/缓存未带 quality 时把当前曲标签清掉
  if (!label) return;
  useAudioStore.getState().setActualQuality(trackKeyOf(song), label);
}

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function songSourceOf(song: Pick<QueueItem, 'source'>): MusicSource {
  return song.source || 'netease';
}

function normalizeMatchText(value: string | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[（(【\[].*?(?:feat\.?|ft\.?|live|伴奏|翻唱|remix).*?[）)】\]]/gi, '')
    .replace(/\b(?:feat\.?|ft\.?)\b.*$/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function durationSeconds(value: number | undefined): number | null {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  return duration > 10_000 ? duration / 1000 : duration;
}

function scoreFallbackCandidate(song: QueueItem, candidate: SearchResult): number {
  if (!candidate.id || candidate.source === songSourceOf(song)) return -1;
  const wantedTitle = normalizeMatchText(song.name);
  const candidateTitle = normalizeMatchText(candidate.name);
  if (!wantedTitle || !candidateTitle) return -1;

  let score = 0;
  if (wantedTitle === candidateTitle) score += 70;
  else if (
    Math.min(wantedTitle.length, candidateTitle.length) >= 5
    && (wantedTitle.includes(candidateTitle) || candidateTitle.includes(wantedTitle))
  ) score += 42;
  else return -1;

  const wantedArtist = normalizeMatchText(song.artist);
  const candidateArtist = normalizeMatchText(candidate.artist);
  if (wantedArtist && candidateArtist) {
    if (wantedArtist === candidateArtist) score += 30;
    else if (wantedArtist.includes(candidateArtist) || candidateArtist.includes(wantedArtist)) score += 20;
    else return -1;
  }

  const wantedDuration = durationSeconds(song.duration);
  const candidateDuration = durationSeconds(candidate.duration);
  if (wantedDuration && candidateDuration) {
    const difference = Math.abs(wantedDuration - candidateDuration);
    if (difference > 30) return -1;
    if (difference <= 5) score += 20;
    else if (difference <= 12) score += 12;
  }
  return score;
}

async function findCrossSourceCandidates(song: QueueItem): Promise<SearchResult[]> {
  const cacheKey = `${songSourceOf(song)}:${normalizeMatchText(song.name)}:${normalizeMatchText(song.artist)}`;
  const cached = crossSourceCandidateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.candidates;

  const sources = ALL_MUSIC_SOURCES.filter((source) => source !== songSourceOf(song));
  const batches = await Promise.allSettled(sources.map((source) => searchSongs(source, song.name)));
  const candidates = batches.flatMap((batch) => batch.status === 'fulfilled' ? batch.value : [])
    .map((candidate) => ({ candidate, score: scoreFallbackCandidate(song, candidate) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.candidate);

  crossSourceCandidateCache.set(cacheKey, {
    expiresAt: Date.now() + CROSS_SOURCE_CACHE_TTL_MS,
    candidates,
  });
  return candidates;
}

async function fetchCrossSourceFallback(song: QueueItem): Promise<string | null> {
  const key = trackKeyOf(song);
  const pending = pendingCrossSourceFallbacks.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const candidates = await findCrossSourceCandidates(song);
    for (const candidate of candidates) {
      try {
        const quality = getLowestQuality(candidate.source) ?? getUserPlaybackQuality(candidate.source);
        const info = await getSongUrlInfo(candidate, quality);
        if (!info.url || isBlockedPlaybackUrl(info.url)) continue;
        urlCache.set(urlCacheKey(song, getEffectivePlaybackQuality(song)), {
          url: info.url,
          qualityLabel: info.qualityLabel,
        });
        trimUrlCache();
        clearTrackSourceError(song);
        publishActualQuality(song, info.qualityLabel);
        return info.url;
      } catch {
        // 当前候选不可播放时继续尝试下一平台/版本。
      }
    }
    return null;
  })().finally(() => pendingCrossSourceFallbacks.delete(key));

  pendingCrossSourceFallbacks.set(key, promise);
  return promise;
}

function getEffectivePlaybackQuality(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>): string | undefined {
  const source = songSourceOf(song);
  if (isPlaybackQualityLockedToLowest()) {
    return getLowestQuality(source) ?? getUserPlaybackQuality(source);
  }
  return getUserPlaybackQuality(source);
}

function songLikelyNeedsPlaybackProxy(song: Pick<QueueItem, 'source' | 'url'>): boolean {
  if (shouldProxySongPlaybackUrl()) return true;
  if (!isHttpsPageContext()) return false;
  // 酷狗迟言链基本为 http://，HTTPS 站点必须走 media-proxy（不可升 https）
  if (songSourceOf(song) === 'kugou') return true;
  return Boolean(song.url?.trim().startsWith('http://'));
}

function urlCacheKey(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  quality?: string,
) {
  const effective = quality ?? getEffectivePlaybackQuality(song);
  const proxyTag = songLikelyNeedsPlaybackProxy(song) ? 'proxy' : 'direct';
  return `${trackKeyOf(song)}:${effective || 'default'}:${proxyTag}`;
}

export function clearSongUrlCache() {
  urlCache.clear();
  pendingFetches.clear();
  resetPlaybackQualityLock();
  try {
    sessionStorage.removeItem(URL_CACHE_STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable.
  }
}

/** 清除指定曲目的全部 URL 缓存（含 proxy/direct、各音质档） */
export function invalidateTrackUrlCache(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  const prefix = trackKeyOf(song);
  let changed = false;

  for (const key of [...urlCache.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) {
      urlCache.delete(key);
      changed = true;
    }
  }

  if (changed) {
    pendingFetches.clear();
    persistUrlCacheToStorage();
  }
}

/** 切换音质时保留当前已加载曲目，仅让未加载歌曲按新音质重新取链 */
export function invalidateUnloadedSongUrlCache(keepTrackKey?: string | null) {
  const keepKey = keepTrackKey?.trim() || null;

  for (const key of [...urlCache.keys()]) {
    if (keepKey && (key === keepKey || key.startsWith(`${keepKey}:`))) continue;
    urlCache.delete(key);
  }

  pendingFetches.clear();
  resetPlaybackQualityLock();
  persistUrlCacheToStorage();
}

function trimUrlCache() {
  while (urlCache.size > MAX_URL_CACHE) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    urlCache.delete(oldest);
  }
  persistUrlCacheToStorage();
}

async function fetchSongUrlOnce(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  quality: string | undefined,
  options: { refresh?: boolean } = {},
): Promise<FetchUrlResult> {
  const key = urlCacheKey(song, quality);
  if (options.refresh) {
    urlCache.delete(key);
  } else {
    const cached = urlCache.get(key);
    if (cached) {
      // 历史缓存里的网易 outer/url 假直链不可播，丢弃后重新取链
      if (/music\.163\.com\/song\/media\/outer\/url/i.test(cached.url)) {
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else if (isBlockedPlaybackUrl(cached.url)) {
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else if (
        !cached.qualityLabel
        && songSourceOf(song) !== 'kugou'
      ) {
        // 旧缓存没有实际音质字段，强制重取以拿到 type=url 的 quality
        urlCache.delete(key);
        persistUrlCacheToStorage();
      } else {
        return { ok: true, url: cached.url, qualityLabel: cached.qualityLabel };
      }
    }
  }

  const pendingKey = options.refresh ? `${key}:refresh` : key;
  const pending = pendingFetches.get(pendingKey);
  if (pending) return pending;

  const promise = (async (): Promise<FetchUrlResult> => {
    try {
      let url: string | null = null;
      let qualityLabel: string | undefined;
      try {
        const info = await getSongUrlInfo({
          id: song.id,
          source: songSourceOf(song),
          url: options.refresh ? undefined : song.url,
        }, quality);
        url = info.url;
        qualityLabel = info.qualityLabel;
      } catch (error) {
        return { ok: false, errorClass: classifySongUrlFetchError(error) };
      }

      if (!url || isBlockedPlaybackUrl(url)) {
        return { ok: false, errorClass: classifySongUrlFetchFailure(url) };
      }

      urlCache.set(key, { url, qualityLabel });
      trimUrlCache();
      return { ok: true, url, qualityLabel };
    } finally {
      pendingFetches.delete(pendingKey);
    }
  })();

  pendingFetches.set(pendingKey, promise);
  return promise;
}

async function tryLowestQualityFetch(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): Promise<FetchUrlResult> {
  const source = songSourceOf(song);
  const lowest = getLowestQuality(source);
  if (!lowest) return { ok: false, errorClass: 'service' };

  lockPlaybackQualityToLowest();
  return fetchSongUrlOnce(song, lowest, { refresh: true });
}

async function fetchSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
  options: { refresh?: boolean } = {},
): Promise<CachedUrlEntry | null> {
  const source = songSourceOf(song);
  const quality = getEffectivePlaybackQuality(song);
  const lowest = getLowestQuality(source);
  const alreadyAtLowest = Boolean(lowest && quality === lowest);

  const first = await fetchSongUrlOnce(song, quality, options);
  if (first.ok) {
    clearTrackSourceError(song);
    publishActualQuality(song, first.qualityLabel);
    return { url: first.url, qualityLabel: first.qualityLabel };
  }

  if (first.errorClass === 'temporary') {
    return null;
  }

  if (alreadyAtLowest) {
    if (useRoomStore.getState().isPlaybackLeader) {
      markTrackSourceError(song);
    }
    return null;
  }

  const fallback = await tryLowestQualityFetch(song);
  if (fallback.ok) {
    clearTrackSourceError(song);
    publishActualQuality(song, fallback.qualityLabel);
    return { url: fallback.url, qualityLabel: fallback.qualityLabel };
  }

  const crossSource = await fetchCrossSourceFallback(song as QueueItem);
  if (crossSource) return { url: crossSource };

  if (useRoomStore.getState().isPlaybackLeader) {
    markTrackSourceError(song);
  }
  return null;
}

/** B 类服务错误：单级降至最低档并重取 URL（仅调用方负责重试 1 次播放） */
export async function fetchServiceFallbackUrl(
  song: QueueItem,
): Promise<string | null> {
  const source = songSourceOf(song);
  const quality = getEffectivePlaybackQuality(song);
  const lowest = getLowestQuality(source);

  if (lowest && quality === lowest) {
    // 当前平台最低音质仍触发播放错误时，刷新同一地址意义不大，直接切换平台。
    return fetchCrossSourceFallback(song);
  }

  const fallback = await tryLowestQualityFetch(song);
  if (fallback.ok) {
    publishActualQuality(song, fallback.qualityLabel);
    return fallback.url;
  }
  return fetchCrossSourceFallback(song);
}

export function rememberSongUrl(trackKey: string, url: string, qualityLabel?: string) {
  const existing = urlCache.get(trackKey);
  urlCache.set(trackKey, {
    url,
    qualityLabel: qualityLabel?.trim() || existing?.qualityLabel,
  });
  trimUrlCache();
}

/** 从缓存恢复当前曲实际音质（跳过重新加载时用） */
export function syncActualQualityFromCache(song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>) {
  const key = urlCacheKey(song, getEffectivePlaybackQuality(song));
  const cached = urlCache.get(key) || urlCache.get(trackKeyOf(song));
  if (cached?.qualityLabel) {
    publishActualQuality(song, cached.qualityLabel);
  }
}

export async function resolveSongUrl(
  song: QueueItem,
  options: { refresh?: boolean } = {},
): Promise<{ url: string; qualityLabel?: string }> {
  const result = await fetchSongUrl(song, options);
  if (!result?.url) throw new Error('empty url');
  return result;
}

/** 加入房间后立即预取当前歌曲 URL，缩短刷新后的加载等待 */
export function prefetchCurrentSong(song: QueueItem | null | undefined) {
  if (!song) return;
  void fetchSongUrl(song);
}

type UrlPrefetchSong = Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>;

/** 预取即将播放的曲目：队列下一首，或私人漫游 nextRandom */
export function prefetchUpcomingFromRoom(
  room: Pick<RoomState, 'current' | 'queue' | 'nextRandom'> | null | undefined,
  options: { count?: number; includeCurrent?: boolean } = {},
) {
  if (!room) return;
  // 切换音质时勿重拉当前曲：否则会按新音质取链并覆盖「实际音质」标签，尽管仍在播旧档
  if (options.includeCurrent !== false && room.current) {
    prefetchCurrentSong(room.current);
  }
  prefetchQueueSongs(room.queue ?? [], {
    current: room.current,
    nextRandom: room.nextRandom,
    count: options.count,
  });
}

export function prefetchQueueSongs(
  queue: QueueItem[],
  options: {
    count?: number;
    current?: QueueItem | null;
    nextRandom?: QueueItem | null;
  } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const maxAhead = Math.max(1, isMobileDevice() ? 1 : count);
  const targets: UrlPrefetchSong[] = [];

  if (queue.length > 0) {
    targets.push(...queue.slice(0, maxAhead));
  } else if (options.nextRandom?.id) {
    targets.push(options.nextRandom);
  }

  if (targets.length === 0) return;

  if (options.current) {
    pruneSourceErrors([options.current, ...targets]);
  } else {
    pruneSourceErrors(targets);
  }

  for (const song of targets) {
    void fetchSongUrl(song);
  }
}

