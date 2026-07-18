import { formatMetingFetchError } from './metingFetch.js';
import { fetchMetingApi } from './metingUpstream.js';

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


export function normalizeFmMode(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_FM_MODE;
  if (FM_MODES.has(raw)) return raw;
  return DEFAULT_FM_MODE;
}

function buildFmQuery(mode) {
  const query = { server: 'netease', type: 'fm' };
  const normalized = normalizeFmMode(mode);
  if (normalized && normalized !== 'DEFAULT') {
    query.id = normalized;
  }
  return query;
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
const FM_RETRY_BACKOFF_MS = 800;
// FM 整体失败后的熔断窗口：空队列的房间会以自动推进节奏反复预取，
// 上游长期不可用时避免每个 tick 都打满 5 次重试
const FM_FAILURE_COOLDOWN_MS = 30_000;
let fmFailureCooldownUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 网易云私人漫游（Meting type=fm） */
export async function fetchMetingFmSong(fmMode = DEFAULT_FM_MODE) {
  if (normalizeFmMode(fmMode) === FM_MODE_OFF) return null;
  if (Date.now() < fmFailureCooldownUntil) return null;

  for (let i = 0; i < MAX_FM_RETRIES; i += 1) {
    if (i > 0) await sleep(FM_RETRY_BACKOFF_MS * i);
    try {
      const response = await fetchMetingApi(buildFmQuery(fmMode), {}, 12000);
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
      if (song) {
        fmFailureCooldownUntil = 0;
        return song;
      }
    } catch (err) {
      console.error('Meting FM error:', formatMetingFetchError(err));
    }
  }

  fmFailureCooldownUntil = Date.now() + FM_FAILURE_COOLDOWN_MS;
  console.error(`Meting FM 连续 ${MAX_FM_RETRIES} 次失败，${FM_FAILURE_COOLDOWN_MS / 1000}s 内暂停漫游预取`);
  return null;
}
