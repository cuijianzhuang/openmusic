import { resolveSignedApiUrl } from './signedApiUrl';

export type PlaybackErrorClass = 'temporary' | 'service';

const SERVICE_HTTP_STATUSES = new Set([403, 404, 502]);
const URL_PROBE_TIMEOUT_MS = 5000;

export const MAX_TEMP_PLAYBACK_RETRIES = 3;

function isInvalidPlaybackUrl(url: string | undefined | null): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (!trimmed) return true;
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
