import { fetchWithTimeout } from '../api/http';

type LocalSource = { url?: unknown; auth?: unknown };
type WorkerResult = { id: number; data?: ArrayBuffer; contentType?: string; error?: string };

export type QishuiLocalPlaybackResult =
  | { status: 'ok'; url: string }
  | { status: 'aborted' }
  | { status: 'failed' };

const LOCAL_DECRYPT_TIMEOUT_MS = 20_000;
const LOCAL_SOURCE_FETCH_TIMEOUT_MS = 5_000;
const MAX_LOCAL_AUDIO_CACHE = 3;
const blobCache = new Map<string, string>();
const pending = new Map<string, Promise<QishuiLocalPlaybackResult>>();
let requestId = 0;

function sourceToken(wrappedUrl: string): string {
  try {
    return new URL(wrappedUrl, window.location.origin).searchParams.get('t')?.trim() || '';
  } catch {
    return '';
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function remember(key: string, url: string): string {
  const old = blobCache.get(key);
  if (old && old !== url) URL.revokeObjectURL(old);
  blobCache.delete(key);
  blobCache.set(key, url);
  while (blobCache.size > MAX_LOCAL_AUDIO_CACHE) {
    const oldest = blobCache.keys().next().value;
    if (!oldest) break;
    const oldUrl = blobCache.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    blobCache.delete(oldest);
  }
  return url;
}

function runWorker(sourceUrl: string, auth: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const worker = new Worker(new URL('../workers/qishuiDecryptWorker.ts', import.meta.url), { type: 'module' });
    const abort = () => {
      worker.terminate();
      reject(new DOMException('汽水本地解密已取消', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('汽水本地解密超时'));
    }, LOCAL_DECRYPT_TIMEOUT_MS);
    if (signal?.aborted) {
      window.clearTimeout(timer);
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (!event.data.data) {
        reject(new Error(event.data.error || '汽水本地解密失败'));
        return;
      }
      resolve(URL.createObjectURL(new Blob([event.data.data], { type: event.data.contentType || 'audio/mp4' })));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      reject(new Error(event.message || '汽水本地解密 Worker 失败'));
    };
    worker.postMessage({ id, url: sourceUrl, auth });
  });
}

async function resolveLocalPlaybackUrl(
  wrappedUrl: string,
  signal?: AbortSignal,
): Promise<QishuiLocalPlaybackResult> {
  const token = sourceToken(wrappedUrl);
  if (!token || typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { status: 'failed' };
  }
  if (signal?.aborted) return { status: 'aborted' };

  const cacheKey = token;
  const cached = blobCache.get(cacheKey);
  if (cached) {
    blobCache.delete(cacheKey);
    blobCache.set(cacheKey, cached);
    return { status: 'ok', url: cached };
  }

  const existing = pending.get(cacheKey);
  if (existing) {
    const shared = await existing;
    // 调用方自己已取消：静默 aborted，勿当解密失败
    if (signal?.aborted) return { status: 'aborted' };
    // 共享任务被上一任播放路径 abort：本调用仍有效则重开，避免误报失败
    if (shared.status === 'aborted') {
      return resolveLocalPlaybackUrl(wrappedUrl, signal);
    }
    return shared;
  }

  const task = (async (): Promise<QishuiLocalPlaybackResult> => {
    if (signal?.aborted) return { status: 'aborted' };
    try {
      const response = await fetchWithTimeout(
        `/api/qishui-source?t=${encodeURIComponent(token)}`,
        { cache: 'no-store', signal },
        LOCAL_SOURCE_FETCH_TIMEOUT_MS,
      );
      if (signal?.aborted) return { status: 'aborted' };
      if (!response.ok) return { status: 'failed' };
      const payload = await response.json() as LocalSource;
      const sourceUrl = typeof payload.url === 'string' ? payload.url : '';
      const auth = typeof payload.auth === 'string' ? payload.auth : '';
      if (!sourceUrl || !auth) return { status: 'failed' };
      const blobUrl = await runWorker(sourceUrl, auth, signal);
      if (signal?.aborted) return { status: 'aborted' };
      return { status: 'ok', url: remember(cacheKey, blobUrl) };
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) return { status: 'aborted' };
      return { status: 'failed' };
    }
  })().finally(() => {
    pending.delete(cacheKey);
  });

  pending.set(cacheKey, task);
  return task;
}

export async function resolveQishuiLocalPlaybackUrl(
  url: string,
  signal?: AbortSignal,
): Promise<QishuiLocalPlaybackResult> {
  if (!url || !/\/api\/(?:qishui-source|qishui-audio)(?:\?|$)/i.test(url)) {
    return { status: 'failed' };
  }
  return resolveLocalPlaybackUrl(url, signal);
}

/** 预取阶段提前解密；与播放路径共用 blob 缓存，命中则切歌可秒开 */
export function prefetchQishuiLocalPlayback(url: string | null | undefined): void {
  if (!url || !/\/api\/(?:qishui-source|qishui-audio)(?:\?|$)/i.test(url)) return;
  void resolveLocalPlaybackUrl(url);
}
