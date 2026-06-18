const CYAPI_BASE = (
  process.env.CYAPI_BASE
  || process.env.CYAPI_URL?.replace(/\/qq_music\.php$/i, '')
  || 'https://cyapi.top/API'
).replace(/\/$/, '');

const CYAPI_KEY = process.env.CYAPI_KEY || '';

export function isCyapiConfigured() {
  return Boolean(CYAPI_KEY);
}

export function getCyapiKey() {
  return CYAPI_KEY;
}

export function qqMusicEndpoint() {
  if (process.env.CYAPI_URL) {
    return process.env.CYAPI_URL.replace(/\/$/, '');
  }
  return `${CYAPI_BASE}/qq_music.php`;
}

export function kugouMusicEndpoint() {
  return `${CYAPI_BASE}/kugou_music.php`;
}

export function wyrpEndpoint() {
  return `${CYAPI_BASE}/wyrp.php`;
}

const MAX_RANDOM_RETRIES = 20;

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

async function fetchRandomSongOnce() {
  try {
    const params = new URLSearchParams();
    if (CYAPI_KEY) params.set('apikey', CYAPI_KEY);
    const query = params.toString();
    const targetUrl = query ? `${wyrpEndpoint()}?${query}` : wyrpEndpoint();

    const response = await fetch(targetUrl);
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
    };
  } catch (err) {
    console.error('Random song API error:', err.message);
    return null;
  }
}

function randomSongKey(song) {
  return `netease:${song.id}`;
}

function resolveExcludeKeys(excludeKeys) {
  return typeof excludeKeys === 'function' ? excludeKeys() : excludeKeys;
}

/** 队列为空时随机推荐（迟言 wyrp 网易云热评） */
export async function fetchRandomSong(excludeKeys = new Set()) {
  for (let i = 0; i < MAX_RANDOM_RETRIES; i++) {
    const song = await fetchRandomSongOnce();
    if (!song) continue;
    if (!shouldPlayRandomSong(song.name)) continue;
    if (resolveExcludeKeys(excludeKeys).has(randomSongKey(song))) continue;
    return song;
  }
  return null;
}

function withApiKey(params) {
  const search = new URLSearchParams(params);
  search.set('apikey', CYAPI_KEY);
  return search;
}

/** QQ 音乐搜索：n=1..num 并行拉取 */
export async function searchQqMusic(keyword, num = 15) {
  const limit = Math.min(Math.max(num, 1), 30);
  const endpoint = qqMusicEndpoint();

  const tasks = Array.from({ length: limit }, (_, i) => {
    const params = withApiKey({
      msg: keyword,
      num: String(limit),
      type: 'json',
      n: String(i + 1),
    });
    return fetch(`${endpoint}?${params}`).then((r) => r.json());
  });

  const results = await Promise.allSettled(tasks);
  const songs = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const data = result.value;
    if (!data || data.error || !data.id) continue;
    songs.push(data);
  }

  return songs;
}

/** 酷狗音乐搜索 */
export async function searchKugouMusic(keyword, limit = 15) {
  const params = withApiKey({ msg: keyword });
  const response = await fetch(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !Array.isArray(data.list)) {
    return [];
  }

  return data.list.slice(0, Math.min(Math.max(limit, 1), 30));
}

/** 酷狗音乐详情（播放链接、歌词、封面） */
export async function getKugouSongDetail(id) {
  const params = withApiKey({ id });
  const response = await fetch(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !data.data) {
    return null;
  }

  const detail = data.data;
  return {
    id,
    name: detail.songName || '',
    artist: detail.singerName || '',
    url: detail.url || '',
    pic: detail.albumImage || '',
    duration: detail.timeLength ? detail.timeLength * 1000 : undefined,
    lrc: detail.lyrics || '',
  };
}
