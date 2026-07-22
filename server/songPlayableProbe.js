import { fetchMetingApi } from './metingUpstream.js';
import { getKugouSongDetail, isCyapiConfigured } from './cyapi.js';
import { fetchCustomMusicApi, hasCustomMusicApi } from './customMusicApi.js';

const QQ_PLACEHOLDER_HOST = 'aqqmusic.tc.qq.com';
const MEDIA_FILE_EXT = /\.(mp3|m4a|flac|ogg|wav|aac|wma)$/i;

function normalizeUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text.startsWith('@') ? text.slice(1).trim() : text;
}

function isQqPlaceholderUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== QQ_PLACEHOLDER_HOST) return false;
    const pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname || pathname === '/') return true;
    return !MEDIA_FILE_EXT.test(pathname);
  } catch {
    return false;
  }
}

function isPlayableHttpUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized.startsWith('http')) return false;
  if (isQqPlaceholderUrl(normalized)) return false;
  return true;
}

function parseUrlPayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      return normalizeUrl(data?.url);
    } catch {
      return '';
    }
  }
  return normalizeUrl(text);
}

async function probeMetingUrl(source, id) {
  const response = await fetchMetingApi(
    { server: source, type: 'url', id },
    { redirect: 'manual' },
    12000,
  );

  if (response.status >= 300 && response.status < 400) {
    const location = normalizeUrl(response.headers.get('location'));
    return isPlayableHttpUrl(location);
  }

  if (response.status === 404 || response.status === 403) return false;
  if (response.status >= 400) return false;

  const text = await response.text();
  const url = parseUrlPayload(text);
  return isPlayableHttpUrl(url);
}

async function probeKugouUrl(id) {
  if (hasCustomMusicApi('kugou', 'url')) {
    try {
      const custom = await fetchCustomMusicApi({
        server: 'kugou',
        type: 'url',
        id,
      });
      if (custom) {
        const text = await custom.text();
        const url = parseUrlPayload(text);
        if (isPlayableHttpUrl(url)) return true;
        if (custom.status >= 400) return false;
      }
    } catch {
      // fall through to cyapi
    }
  }

  if (!isCyapiConfigured()) return false;
  try {
    const detail = await getKugouSongDetail(id);
    return isPlayableHttpUrl(detail?.url || detail?.data?.url || '');
  } catch {
    return false;
  }
}

/**
 * 服务端探测当前曲是否仍可解析出可播放地址。
 * 用于 source_error 切歌：避免主控本机网络差误判为全屋音源异常。
 */
export async function isSongPlayableOnServer(song) {
  const id = String(song?.id || '').trim();
  if (!id) return false;

  const source = String(song?.source || 'netease').toLowerCase();
  try {
    if (source === 'kugou') return await probeKugouUrl(id);
    if (source === 'netease' || source === 'tencent') {
      return await probeMetingUrl(source, id);
    }
    return false;
  } catch (err) {
    console.warn(`音源探测失败（${source}:${id}）：`, err?.message || err);
    // 探测本身失败（上游抖动）时不视为「确认无源」，避免误切
    return true;
  }
}
