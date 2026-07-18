import { fetchMetingApi } from './metingUpstream.js';

const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractUrlFromText(input) {
  const text = String(input || '').trim();
  const match = text.match(/https?:\/\/[^\s\u4e00-\u9fff「」]+/i);
  return match ? match[0].replace(/[.,;，。；)）\]]+$/, '') : text;
}

export function parseNeteasePlaylistId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^\d{4,}$/.test(text)) return text;

  const url = extractUrlFromText(text);
  if (!/music\.163\.com|y\.music\.163\.com/i.test(url)) return null;

  const idMatch = url.match(/[?&]id=(\d+)/i) || url.match(/playlist\/(\d+)/i);
  return idMatch ? idMatch[1] : null;
}

export function parseQqPlaylistId(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (/^\d{4,}$/.test(text)) return text;

  const url = extractUrlFromText(text);
  if (!/\.qq\.com/i.test(url)) return null;
  if (!/playlist|songlist|details/i.test(url) && !/[?&]id=\d+/i.test(url)) return null;

  const idMatch = url.match(/[?&]id=(\d+)/i)
    || url.match(/\/playlist\/(\d+)/i)
    || url.match(/\/songlist\/(\d+)/i);
  return idMatch ? idMatch[1] : null;
}

/** @deprecated 使用 parseQqPlaylistId */
export function parseQqPlaylistUrl(input) {
  const id = parseQqPlaylistId(input);
  return id ? String(input).trim() : null;
}

function extractIdFromApiUrl(url) {
  const match = String(url || '').match(/[?&]id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function normalizeMetingPlaylistSong(raw, source) {
  if (!raw || typeof raw !== 'object') return null;

  const id = extractIdFromApiUrl(raw.url) || String(raw.id || raw.mid || '').trim();
  if (!id) return null;

  return {
    id,
    source,
    name: String(raw.title || raw.name || '未知歌曲'),
    artist: String(raw.author || raw.artist || '未知歌手'),
    album: String(raw.album || ''),
    pic: String(raw.pic || raw.cover || ''),
    lrc: raw.lrc ? String(raw.lrc) : undefined,
  };
}

async function fetchNeteasePlaylistMeta(playlistId) {
  try {
    const response = await fetchWithTimeout(
      `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(playlistId)}`,
      { headers: NETEASE_HEADERS },
      10000,
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (data.code !== 200 || !data.result) return null;
    const result = data.result;
    return {
      id: String(result.id || playlistId),
      name: String(result.name || '未命名歌单'),
      coverImgUrl: String(result.coverImgUrl || result.picUrl || ''),
      creatorName: String(result.creator?.nickname || ''),
      trackCount: Number(result.trackCount || 0),
      playCount: Number(result.playCount || 0),
    };
  } catch {
    return null;
  }
}

async function fetchNeteasePlaylistName(playlistId) {
  const meta = await fetchNeteasePlaylistMeta(playlistId);
  return meta?.name || null;
}

export async function fetchNeteasePlaylistMetas(playlistIds) {
  const unique = [...new Set(playlistIds.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 12);
  const results = [];

  for (const id of unique) {
    let meta = await fetchNeteasePlaylistMeta(id);
    if (!meta) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      meta = await fetchNeteasePlaylistMeta(id);
    }
    if (meta) results.push(meta);
  }

  return results;
}

async function fetchMetingPlaylist(server, playlistId) {
  const response = await fetchMetingApi(
    { server, type: 'playlist', id: playlistId },
    { headers: NETEASE_HEADERS },
    60000,
  );
  if (!response.ok) throw new Error('歌单请求失败');

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error(typeof data?.error === 'string' ? data.error : '歌单数据格式异常');
  }
  return data;
}

async function importMetingPlaylist(server, playlistId, defaultName) {
  const tracks = await fetchMetingPlaylist(server, playlistId);

  if (tracks.length === 0) {
    return {
      name: defaultName,
      playlistId,
      source: server === 'netease' ? 'netease' : 'tencent',
      songs: [],
      total: 0,
      failed: 0,
    };
  }

  const songs = tracks
    .map((track) => normalizeMetingPlaylistSong(track, server === 'netease' ? 'netease' : 'tencent'))
    .filter(Boolean);

  return {
    name: defaultName,
    playlistId,
    source: server === 'netease' ? 'netease' : 'tencent',
    songs,
    total: tracks.length,
    failed: tracks.length - songs.length,
  };
}

export async function importNeteasePlaylist(input) {
  const playlistId = parseNeteasePlaylistId(input);
  if (!playlistId) throw new Error('无法识别红点歌单链接，请粘贴完整分享链接');

  const [result, name] = await Promise.all([
    importMetingPlaylist('netease', playlistId, '红点歌单'),
    fetchNeteasePlaylistName(playlistId),
  ]);

  if (name) result.name = name;
  return result;
}

export async function importQqPlaylist(input) {
  const playlistId = parseQqPlaylistId(input);
  if (!playlistId) {
    throw new Error('无法识别绿点歌单链接，请按提示获取分享链接');
  }

  return importMetingPlaylist('tencent', playlistId, '绿点歌单');
}
