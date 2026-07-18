import { getRuntimeConfig } from './runtimeConfig.js';

export function isCyapiConfigured() {
  return Boolean(getRuntimeConfig().cyapiKey);
}

function kugouMusicEndpoint() {
  return `${getRuntimeConfig().cyapiBase}/kugou_music.php`;
}

function wyrpEndpoint() {
  return `${getRuntimeConfig().cyapiBase}/wyrp.php`;
}

function tpshEndpoint() {
  return `${getRuntimeConfig().cyapiBase}/tpsh.php`;
}

const IMAGE_MODERATION_TIMEOUT_MS = 15000;
/** GET 查询串过长时改传 base64 本体，避免 URL 超限 */
const MAX_PIC_QUERY_LEN = 6000;

const MAX_RANDOM_RETRIES = 20;
const LRC_TAIL_PADDING_MS = 20000;
const RANDOM_DURATION_TIMEOUT_MS = 4000;
const MP3_BITRATES = [
  null, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, null,
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function withApiKey(params) {
  const search = new URLSearchParams(params);
  search.set('apikey', getRuntimeConfig().cyapiKey);
  return search;
}

/** 随机推荐是否可播放：歌名须含中文，排除纯英文/日文/韩文 */
function shouldPlayRandomSong(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed)) return false;
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) return false;
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(trimmed)) return false;
  return true;
}

function extractNeteaseIdFromLink(link) {
  const match = String(link || '').match(/[?&]id=(\d+)/);
  return match ? match[1] : '';
}

function normalizeDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const ms = duration < 10000 ? duration * 1000 : duration;
  return validateDurationMs(ms);
}

function validateDurationMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 && ms < 24 * 60 * 60 * 1000
    ? Math.round(ms)
    : undefined;
}

function parseHeaderDurationMs(headers) {
  for (const name of ['x-content-duration', 'content-duration', 'duration']) {
    const value = headers.get(name);
    const ms = normalizeDurationMs(value);
    if (ms) return ms;
  }
  return undefined;
}

function getContentLength(headers) {
  const range = headers.get('content-range');
  const match = range?.match(/\/(\d+)$/);
  const total = Number(match?.[1]);
  if (Number.isFinite(total) && total > 0) return total;

  const direct = Number(headers.get('content-length'));
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
}

function readSynchsafeInt(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
}

function findMp3BitrateKbps(bytes) {
  let offset = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10 + readSynchsafeInt(bytes, 6);
  }

  for (let i = offset; i + 4 < bytes.length; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;

    const versionBits = (bytes[i + 1] >> 3) & 0x03;
    const layerBits = (bytes[i + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[i + 2] >> 4) & 0x0f;
    if (versionBits !== 0x03 || layerBits !== 0x01) continue;

    const bitrate = MP3_BITRATES[bitrateIndex];
    if (bitrate) return bitrate;
  }

  return 0;
}

async function resolveMp3DurationMs(url) {
  if (!url) return undefined;

  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' }, RANDOM_DURATION_TIMEOUT_MS);
    if (head.ok) {
      const headerDuration = parseHeaderDurationMs(head.headers);
      if (headerDuration) return headerDuration;
    }

    const range = await fetchWithTimeout(
      url,
      { headers: { Range: 'bytes=0-65535' } },
      RANDOM_DURATION_TIMEOUT_MS,
    );
    if (!range.ok && range.status !== 206) return undefined;

    const headerDuration = parseHeaderDurationMs(range.headers);
    if (headerDuration) return headerDuration;

    const totalBytes = getContentLength(range.headers) || getContentLength(head.headers);
    if (!totalBytes) return undefined;

    const bytes = new Uint8Array(await range.arrayBuffer());
    const bitrateKbps = findMp3BitrateKbps(bytes);
    if (!bitrateKbps) return undefined;

    return validateDurationMs((totalBytes * 8) / bitrateKbps);
  } catch {
    return undefined;
  }
}

function getLrcFallbackDurationMs(lrc) {
  let lastTimeSec = 0;
  const regex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const PHANTOM_LRC_MINUTES = 90;
  for (const line of String(lrc || '').split('\n')) {
    let match;
    while ((match = regex.exec(line))) {
      const minutes = Number(match[1]);
      if (minutes >= PHANTOM_LRC_MINUTES) continue;
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
      const time = minutes * 60 + seconds + fraction;
      if (Number.isFinite(time) && time > lastTimeSec) lastTimeSec = time;
    }
  }

  return lastTimeSec > 0 ? Math.round(lastTimeSec * 1000 + LRC_TAIL_PADDING_MS) : undefined;
}

async function fetchFallbackLrc(songName) {
  const msg = String(songName || '').trim();
  if (!msg) return '';

  try {
    const params = new URLSearchParams({ msg, n: '1' });
    const response = await fetchWithTimeout(`${getRuntimeConfig().vmyLrcUrl}?${params}`, {}, RANDOM_DURATION_TIMEOUT_MS);
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

async function resolveRandomDurationMs(song, raw) {
  const explicit = normalizeDurationMs(
    raw.duration ?? raw.time ?? raw.interval ?? raw.durationMs ?? raw.timeLength,
  );
  if (explicit) return explicit;

  const mp3Duration = await resolveMp3DurationMs(song.url);
  if (mp3Duration) return mp3Duration;

  const lrc = raw.lrc || raw.lyric || raw.lyrics || await fetchFallbackLrc(song.name);
  return getLrcFallbackDurationMs(lrc);
}

async function fetchRandomSongOnce() {
  const cyapiKey = getRuntimeConfig().cyapiKey;
  if (!cyapiKey) return null;

  try {
    const params = new URLSearchParams({ apikey: cyapiKey });
    const response = await fetchWithTimeout(`${wyrpEndpoint()}?${params}`);
    if (!response.ok) return null;

    const json = await response.json();
    if (!json.song || !json.url) return null;

    const id = extractNeteaseIdFromLink(json.link);
    if (!id) return null;

    return {
      id,
      source: 'netease',
      name: json.song || '未知歌曲',
      artist: json.singer || '未知歌手',
      album: '',
      pic: json.pic || '',
      url: json.url,
      raw: json,
    };
  } catch (err) {
    console.error('Random song API error:', err.message);
    return null;
  }
}

/** 队列为空时随机推荐（迟言 wyrp 网易云热评） */
export async function fetchRandomSong() {
  for (let i = 0; i < MAX_RANDOM_RETRIES; i++) {
    const song = await fetchRandomSongOnce();
    if (!song) continue;
    if (!shouldPlayRandomSong(song.name)) continue;

    const { raw, ...safeSong } = song;
    const duration = await resolveRandomDurationMs(safeSong, raw);
    return duration ? { ...safeSong, duration } : safeSong;
  }
  return null;
}

/** 酷狗音乐搜索 */
export async function searchKugouMusic(keyword, limit = 15) {
  const params = withApiKey({ msg: keyword });
  const response = await fetchWithTimeout(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !Array.isArray(data.list)) {
    return [];
  }

  return data.list.slice(0, Math.min(Math.max(limit, 1), 30));
}

/** 酷狗音乐详情（播放链接、歌词、封面） */
export async function getKugouSongDetail(id) {
  const params = withApiKey({ id });
  const response = await fetchWithTimeout(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !data.data) {
    return null;
  }

  const detail = data.data;
  return {
    id,
    name: detail.songName || '',
    artist: detail.singerName || '',
    // 酷狗播放链仅 http，不可升 https（证书失败会卡死/重试）
    url: detail.url || '',
    pic: detail.albumImage || '',
    duration: detail.timeLength ? detail.timeLength * 1000 : undefined,
    lrc: detail.lyrics || '',
  };
}

function normalizeCyapiImageParam(pic) {
  const raw = String(pic || '').trim();
  if (!raw) return '';

  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',');
    if (comma < 0) return raw;
    const body = raw.slice(comma + 1);
    return body.length <= MAX_PIC_QUERY_LEN ? raw : body;
  }

  return raw;
}

function buildImageModerationError(data) {
  const detail = String(
    data?.violation_content
    || data?.violation_type
    || data?.violation
    || data?.label
    || data?.msg
    || data?.message
    || '',
  ).trim();
  if (detail) return `图片未通过审核：${detail}`;
  return '图片未通过审核，请更换后发送';
}

/**
 * 迟言图片审核（tpsh）。未配置 CYAPI_KEY 时跳过。
 * @param {string} pic 图片 https URL 或 base64 / data URL
 */
export async function moderateCyapiImage(pic) {
  if (!isCyapiConfigured()) {
    return { ok: true };
  }

  const picParam = normalizeCyapiImageParam(pic);
  if (!picParam) return { ok: true };

  try {
    const params = withApiKey({ pic: picParam });
    const query = params.toString();
    if (query.length > 12000) {
      return { ok: false, error: '图片过大，无法完成审核' };
    }

    const response = await fetchWithTimeout(
      `${tpshEndpoint()}?${query}`,
      {},
      IMAGE_MODERATION_TIMEOUT_MS,
    );

    if (response.status === 403) {
      return { ok: false, error: '图片审核服务未授权，请检查 CYAPI_KEY' };
    }
    if (response.status === 429) {
      return { ok: false, error: '图片审核过于频繁，请稍后再试' };
    }
    if (!response.ok) {
      return { ok: false, error: '图片审核暂时不可用，请稍后重试' };
    }

    const data = await response.json();
    if (data?.is_violation === true) {
      return { ok: false, error: buildImageModerationError(data) };
    }
    if (data?.is_violation === false) {
      return { ok: true };
    }

    const code = Number(data?.code);
    if (Number.isFinite(code) && code !== 0 && code !== 200) {
      return { ok: false, error: data?.msg || data?.message || '图片审核失败，请稍后重试' };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: '图片审核暂时不可用，请稍后重试' };
  }
}
