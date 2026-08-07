import { fetchWithTimeout } from '../api/http';

type LocalSource = { url?: unknown; auth?: unknown };
type WorkerResult = { id: number; data?: ArrayBuffer; contentType?: string; error?: string };

const LOCAL_DECRYPT_TIMEOUT_MS = 5_000;
const MAX_LOCAL_AUDIO_CACHE = 2;
const blobCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
let requestId = 0;

function sourceToken(wrappedUrl: string): string {
  try {
    return new URL(wrappedUrl, window.location.origin).searchParams.get('t')?.trim() || '';
  } catch {
    return '';
  }
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

async function resolveLocalPlaybackUrl(wrappedUrl: string, signal?: AbortSignal): Promise<string | null> {
  const token = sourceToken(wrappedUrl);
  if (!token || typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const cached = blobCache.get(wrappedUrl);
  if (cached) {
    blobCache.delete(wrappedUrl);
    blobCache.set(wrappedUrl, cached);
    return cached;
  }
  const existing = pending.get(wrappedUrl);
  if (existing) return existing;

  const task = (async () => {
    const response = await fetchWithTimeout(
      `/api/qishui-source?t=${encodeURIComponent(token)}`,
      { cache: 'no-store', signal },
      2_500,
    );
    if (!response.ok) return null;
    const payload = await response.json() as LocalSource;
    const sourceUrl = typeof payload.url === 'string' ? payload.url : '';
    const auth = typeof payload.auth === 'string' ? payload.auth : '';
    if (!sourceUrl || !auth) return null;
    const blobUrl = await runWorker(sourceUrl, auth, signal);
    return remember(wrappedUrl, blobUrl);
  })().catch(() => null).finally(() => {
    pending.delete(wrappedUrl);
  });
  pending.set(wrappedUrl, task);
  return task;
}

export async function resolveQishuiLocalPlaybackUrl(url: string, signal?: AbortSignal): Promise<string | null> {
  if (!url || !/\/api\/qishui-audio(?:\?|$)/i.test(url)) return null;
  return resolveLocalPlaybackUrl(url, signal);
}
