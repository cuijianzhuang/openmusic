import { resolveSignedApiUrl } from './signedApiUrl';

export type PlaybackErrorClass = 'temporary' | 'service';

const SERVICE_HTTP_STATUSES = new Set([404, 502]);
const URL_PROBE_TIMEOUT_MS = 5000;

export const MAX_TEMP_PLAYBACK_RETRIES = 3;

/** QQ 音乐偶发返回的占位直链域名（无媒体文件路径，仅裸域名） */
const QQ_PLACEHOLDER_HOST = 'aqqmusic.tc.qq.com';

/** pathname 末尾需带常见音频后缀，否则视为占位/无效直链 */
const MEDIA_FILE_EXT = /\.(mp3|m4a|flac|ogg|wav|aac|wma)$/i;

function isQqPlaceholderPlaybackUrl(parsed: URL): boolean {
  if (parsed.hostname !== QQ_PLACEHOLDER_HOST) return false;
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') return true;
  return !MEDIA_FILE_EXT.test(pathname);
}

export function isBlockedPlaybackUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return false;
  try {
    const parsed = new URL(url.trim(), typeof window !== 'undefined' ? window.location.href : 'https://localhost');
    return isQqPlaceholderPlaybackUrl(parsed);
  } catch {
    return false;
  }
}

/** Meting / 曲库上游明确表示无可用播放地址 */
export function isSourceUnavailableMessage(message: string | undefined | null): boolean {
  const normalized = String(message || '').trim().toLowerCase();
  return normalized === 'no url'
    || normalized === 'empty url'
    || normalized === 'blocked playback url';
}

export class SourceUnavailableError extends Error {
  constructor(message = 'no url') {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

function isInvalidPlaybackUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (isBlockedPlaybackUrl(trimmed)) return true;
  try {
    const parsed = new URL(trimmed, window.location.href);
    return !parsed.protocol.startsWith('http');
  } catch {
    return true;
  }
}

export function isServiceHttpStatus(status: number): boolean {
  return SERVICE_HTTP_STATUSES.has(status);
}

async function probeMediaUrlStatus(url: string): Promise<number | null> {
  const probeUrl = (await resolveSignedApiUrl(url)) || url;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), URL_PROBE_TIMEOUT_MS);
  try {
    const head = await fetch(probeUrl, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'include',
    });
    return head.status;
  } catch {
    try {
      const ranged = await fetch(probeUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'include',
      });
      return ranged.status;
    } catch {
      return null;
    }
  } finally {
    window.clearTimeout(timer);
  }
}

/** 拉取播放地址失败（API / 空链） */
export function classifySongUrlFetchFailure(url: string | null | undefined): PlaybackErrorClass {
  if (isInvalidPlaybackUrl(url)) return 'service';
  return 'service';
}

export function classifySongUrlFetchError(error: unknown): PlaybackErrorClass {
  if (error instanceof SourceUnavailableError) return 'service';
  if (error instanceof Error && isSourceUnavailableMessage(error.message)) return 'service';
  if (error instanceof TypeError) return 'temporary';
  if (error instanceof DOMException) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'temporary';
    if (error.name === 'NetworkError') return 'temporary';
  }
  return 'service';
}

/** `<audio>` 播放错误分类 */
export async function classifyMediaPlaybackError(audio: HTMLAudioElement): Promise<PlaybackErrorClass> {
  const url = audio.currentSrc || audio.src;
  if (isInvalidPlaybackUrl(url)) return 'service';

  const mediaError = audio.error;
  if (mediaError?.code === MediaError.MEDIA_ERR_DECODE) return 'temporary';
  if (mediaError?.code === MediaError.MEDIA_ERR_ABORTED) return 'temporary';
  if (mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) return 'service';

  if (
    mediaError?.code === MediaError.MEDIA_ERR_NETWORK
    || mediaError == null
  ) {
    const status = await probeMediaUrlStatus(url);
    if (status != null && isServiceHttpStatus(status)) return 'service';
    return 'temporary';
  }

  return 'temporary';
}
