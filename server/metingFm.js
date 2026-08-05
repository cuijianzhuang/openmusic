import { formatMetingFetchError } from './metingFetch.js';
import { fetchMetingApi, runWithMetingRequestContext } from './metingUpstream.js';
import { fetchEphemeralFmSong } from './metingAdmin.js';

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
  // 汽水 PC feed/song-tab 模式
  'FRESH',
  'SCENE_MODE_ID:2',
  'SCENE_MODE_ID:3',
  'SCENE_MODE_ID:5',
  'SCENE_MODE_ID:40',
  'SCENE_MODE_ID:21',
  'SCENE_MODE_ID:18',
  FM_MODE_OFF,
]);


export function normalizeFmMode(input) {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_FM_MODE;
  if (FM_MODES.has(raw)) return raw;
  return DEFAULT_FM_MODE;
}

function buildFmQuery(mode, source = 'netease') {
  const query = { server: source === 'qishui' ? 'qishui' : 'netease', type: 'fm' };
  const normalized = normalizeFmMode(mode);
  if (query.server === 'netease' && normalized && normalized !== 'DEFAULT') {
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

function normalizeFmSong(raw, source = 'netease', excludedIds = new Set()) {
  const candidates = Array.isArray(raw)
    ? raw.filter((item) => item && typeof item === 'object')
    : [raw];
  const item = candidates.find((candidate) => {
    const url = candidate.url ? String(candidate.url) : '';
    const id = String(candidate.id || extractIdFromUrl(url) || '').trim();
    return id && !excludedIds.has(id);
  }) || null;
  if (!item || typeof item !== 'object') return null;

  const artist = item.artist ?? item.author;
  const artistStr = Array.isArray(artist)
    ? artist.map((a) => a?.name).filter(Boolean).join(' / ')
    : String(artist || '未知歌手');

  const urlStr = item.url ? String(item.url) : '';
  const id = String(item.id || extractIdFromUrl(urlStr) || '').trim();
  const name = String(item.name || item.title || '').trim();
  if (!id || !name) return null;

  const rawDuration = Number(item.duration || item.dt || 0);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0
    ? Math.round(rawDuration < 10_000 ? rawDuration * 1000 : rawDuration)
    : undefined;
  return {
    id,
    source: source === 'qishui' ? 'qishui' : 'netease',
    name,
    artist: artistStr,
    album: String(item.album || item.album_name || ''),
    pic: String(item.pic || item.cover || item.album_pic || ''),
    duration,
    url: urlStr || undefined,
    lrc: item.lrc ? String(item.lrc) : undefined,
  };
}

function normalizeFmSongs(raw, source = 'netease', excludedIds = new Set()) {
  const candidates = Array.isArray(raw) ? raw : [raw];
  const usedIds = new Set(excludedIds);
  const songs = [];
  for (const candidate of candidates) {
    const song = normalizeFmSong(candidate, source, usedIds);
    if (!song) continue;
    usedIds.add(song.id);
    songs.push(song);
  }
  return songs;
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

/**
 * 网易云私人漫游。
 * - 传入 ephemeralCookie（无 VIP 本地账号）：走 Meting /admin/fm，不入库
 * - 否则走 type=fm；有 roomId 时房间账号优先，否则用 Meting 原有 Cookie 池
 */
export async function fetchMetingFmSongs(fmMode = DEFAULT_FM_MODE, options = {}) {
  if (normalizeFmMode(fmMode) === FM_MODE_OFF) return [];
  if (Date.now() < fmFailureCooldownUntil) return [];

  const roomId = String(options.roomId || '').trim();
  const roomName = String(options.roomName || '私人漫游');
  const ephemeralCookie = String(options.ephemeralCookie || '').trim();
  const mode = normalizeFmMode(fmMode);
  const source = options.source === 'qishui' ? 'qishui' : 'netease';
  const modeId = mode === 'DEFAULT' ? '' : mode;
  const excludedIds = new Set(Array.isArray(options.excludeIds) ? options.excludeIds.map((id) => String(id).trim()).filter(Boolean) : []);

  for (let i = 0; i < MAX_FM_RETRIES; i += 1) {
    if (i > 0) await sleep(FM_RETRY_BACKOFF_MS * i);
    try {
      if (ephemeralCookie) {
        const result = await fetchEphemeralFmSong(ephemeralCookie, modeId, source, [...excludedIds]);
        if (!result.ok) {
          console.error('Ephemeral FM error:', result.error);
          continue;
        }
        const songs = normalizeFmSongs(result.data, source, excludedIds);
        if (songs.length) {
          fmFailureCooldownUntil = 0;
          return songs;
        }
        continue;
      }

      const response = await runWithMetingRequestContext(
        {
          userId: '',
          userNickname: '系统',
          roomId,
          roomName,
        },
        () => fetchMetingApi(buildFmQuery(fmMode, source), {}, 12000),
      );
      if (!response.ok) continue;

      const text = await response.text();
      if (!text.trim()) continue;

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }

      const songs = normalizeFmSongs(data, source, excludedIds);
      if (songs.length) {
        fmFailureCooldownUntil = 0;
        return songs;
      }
    } catch (err) {
      console.error('Meting FM error:', formatMetingFetchError(err));
    }
  }

  fmFailureCooldownUntil = Date.now() + FM_FAILURE_COOLDOWN_MS;
  console.error(`Meting FM 连续 ${MAX_FM_RETRIES} 次失败，${FM_FAILURE_COOLDOWN_MS / 1000}s 内暂停漫游预取`);
  return [];
}

export async function fetchMetingFmSong(fmMode = DEFAULT_FM_MODE, options = {}) {
  const songs = await fetchMetingFmSongs(fmMode, options);
  return Array.isArray(songs) ? songs[0] || null : null;
}
