import { getSongUrl, getTrackKey } from '../api/music';
import type { QueueItem } from '../types';
import { configureInlineAudio } from './audioUnlock';

const MAX_URL_CACHE = 24;
const MAX_BUFFER = 2;
const DEFAULT_PREFETCH_COUNT = 2;

const urlCache = new Map<string, string>();
const pendingFetches = new Map<string, Promise<string | null>>();
const bufferAudios = new Map<string, HTMLAudioElement>();

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function trimUrlCache() {
  while (urlCache.size > MAX_URL_CACHE) {
    const oldest = urlCache.keys().next().value;
    if (!oldest) break;
    urlCache.delete(oldest);
    releaseBuffer(oldest);
  }
}

function releaseBuffer(trackKey: string) {
  const audio = bufferAudios.get(trackKey);
  if (!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  bufferAudios.delete(trackKey);
}

function bufferAudio(trackKey: string, url: string) {
  if (bufferAudios.has(trackKey)) return;

  while (bufferAudios.size >= MAX_BUFFER) {
    const oldest = bufferAudios.keys().next().value;
    if (!oldest) break;
    releaseBuffer(oldest);
  }

  const audio = new Audio();
  configureInlineAudio(audio);
  audio.src = url;
  audio.load();
  bufferAudios.set(trackKey, audio);
}

async function fetchSongUrl(
  song: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'>,
): Promise<string | null> {
  const key = trackKeyOf(song);
  const cached = urlCache.get(key);
  if (cached) return cached;

  const pending = pendingFetches.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      let url: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          url = await getSongUrl({
            id: song.id,
            source: song.source || 'netease',
            url: song.url,
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
      pendingFetches.delete(key);
    }
  })();

  pendingFetches.set(key, promise);
  return promise;
}

export function rememberSongUrl(trackKey: string, url: string) {
  urlCache.set(trackKey, url);
  trimUrlCache();
}

export async function resolveSongUrl(song: QueueItem): Promise<string> {
  const url = await fetchSongUrl(song);
  if (!url) throw new Error('empty url');
  return url;
}

export function prefetchQueueSongs(
  queue: QueueItem[],
  options: { count?: number; buffer?: boolean } = {},
) {
  const count = options.count ?? DEFAULT_PREFETCH_COUNT;
  const buffer = options.buffer ?? true;
  const targets = queue.slice(0, count);
  const keepKeys = new Set(targets.map(trackKeyOf));

  for (const key of bufferAudios.keys()) {
    if (!keepKeys.has(key)) releaseBuffer(key);
  }

  for (const song of targets) {
    const key = trackKeyOf(song);
    void fetchSongUrl(song).then((url) => {
      if (url && buffer) bufferAudio(key, url);
    });
  }
}
