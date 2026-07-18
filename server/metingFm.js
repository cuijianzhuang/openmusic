import { fetchMeting, formatMetingFetchError } from './metingFetch.js';

const METING_API_URL = (process.env.METING_API_URL ).replace(/\/$/, '');
const METING_API_AUTH = process.env.METING_API_AUTH || '';

export const DEFAULT_FM_MODE = 'DEFAULT';

/** 关闭漫游：队列放空后停止播放，不自动推荐 */
export const FM_MODE_OFF = 'OFF';

const FM_MODES = new Set([
  'DEFAULT',
  'FAMILIAR',
  'EXPLORE',
  'SCENE_RCMD',
  'aidj',
  'SCENE_RCMD:EXERCISE',
  'SCENE_RCMD:FOCUS',
  'SCENE_RCMD:NIGHT_EMO',
  FM_MODE_OFF,
]);

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  return fetchMeting(url, options, timeoutMs);
}

export function normalizeFmMode(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_FM_MODE;
  if (FM_MODES.has(raw)) return raw;
  return DEFAULT_FM_MODE;
}

function buildFmUrl(mode) {
  const params = new URLSearchParams({ server: 'netease', type: 'fm' });
  const normalized = normalizeFmMode(mode);
  if (normalized && normalized !== 'DEFAULT') {
    params.set('id', normalized);
  }
  if (METING_API_AUTH) params.set('auth', METING_API_AUTH);
  return `${METING_API_URL}/api?${params.toString()}`;
}

function extractIdFromUrl(url) {
  try {
    const match = String(url || '').match(/[?&]id=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

function normalizeFmSong(raw) {
  const item = Array.isArray(raw) ? raw[0] : raw;
  if (!item || typeof item !== 'object') return null;

  const artist = item.artist ?? item.author;
  const artistStr = Array.isArray(artist)
    ? artist.map((a) => a?.name).filter(Boolean).join(' / ')
    : String(artist || '未知歌手');

  const urlStr = item.url ? String(item.url) : '';
  const id = String(item.id || extractIdFromUrl(urlStr) || '').trim();
  const name = String(item.name || item.title || '').trim();
  if (!id || !name) return null;

  const duration = Number(item.duration || item.dt || 0);
  return {
    id,
    source: 'netease',
    name,
    artist: artistStr,
    album: String(item.album || item.album_name || ''),
    pic: String(item.pic || item.cover || item.album_pic || ''),
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    url: urlStr || undefined,
    lrc: item.lrc ? String(item.lrc) : undefined,
  };
}

const MAX_FM_RETRIES = 5;

/** 网易云私人漫游（Meting type=fm） */
export async function fetchMetingFmSong(fmMode = DEFAULT_FM_MODE) {
  if (normalizeFmMode(fmMode) === FM_MODE_OFF) return null;
  for (let i = 0; i < MAX_FM_RETRIES; i += 1) {
    try {
      const response = await fetchWithTimeout(buildFmUrl(fmMode));
      if (!response.ok) continue;

      const text = await response.text();
      if (!text.trim()) continue;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }

      const song = normalizeFmSong(data);
      if (song) return song;
    } catch (err) {
      console.error('Meting FM error:', formatMetingFetchError(err));
    }
  }
  return null;
}
