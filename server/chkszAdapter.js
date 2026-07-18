/**
 * ChKSz API（https://api.chksz.com）适配器：
 * 把 Meting 风格查询（server/type/id/quality）翻译成 chksz 的独立接口，
 * 并返回与 fetchMeting 相同形状的响应对象，使 chksz 可作为普通上游
 * 参与 metingUpstream.js 的负载均衡。仅支持 server=netease。
 */

// Meting/客户端音质取值 → chksz level
const QUALITY_TO_LEVEL = {
  standard: 'standard',
  higher: 'standard',
  exhigh: 'exhigh',
  lossless: 'lossless',
  hires: 'hires',
  128: 'standard',
  320: 'exhigh',
  flac: 'lossless',
  jymaster: 'jymaster',
  sky: 'sky',
  jyeffect: 'jyeffect',
};

export function isMetingUnsupportedError(err) {
  return Boolean(err && err.metingUnsupported === true);
}

function unsupported(message) {
  const err = new Error(message);
  err.metingUnsupported = true;
  return err;
}

function makeResponse(status, contentType, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => {
        const key = String(name).toLowerCase();
        if (key === 'content-type') return contentType;
        return null;
      },
    },
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    arrayBuffer: async () => {
      const buf = Buffer.from(text, 'utf8');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

function redirectResponse(location) {
  return {
    ok: false,
    status: 302,
    headers: {
      get: (name) => (String(name).toLowerCase() === 'location' ? location : null),
    },
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

async function chkszGet(base, path, params, timeoutMs) {
  const search = new URLSearchParams(params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}?${search.toString()}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`chksz 上游返回 ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function requireData(payload) {
  // 部分接口（如 163_playlist）不带 code 字段，仅返回 data
  if (!payload || (payload.code !== undefined && payload.code !== 200) || !payload.data) {
    throw Object.assign(
      new Error(String(payload?.msg || 'chksz 返回异常')),
      { chkszNotFound: true },
    );
  }
  return payload.data;
}

function resolveLevel(quality) {
  return QUALITY_TO_LEVEL[String(quality || '').toLowerCase()] || 'exhigh';
}

async function handleSearch(base, keyword, timeoutMs) {
  const payload = await chkszGet(base, '/api/163_search', { keyword, limit: '50' }, timeoutMs);
  const data = requireData(payload);
  const list = Array.isArray(data) ? data : (Array.isArray(data.songs) ? data.songs : []);
  const songs = list.map((item) => ({
    id: String(item.id || ''),
    name: String(item.name || ''),
    artist: String(item.artists || item.artist || ''),
    album: String(item.album || ''),
    pic: String(item.picUrl || ''),
    // 客户端 duration 语义为毫秒，chksz 原值即毫秒
    duration: Number(item.duration) > 0 ? Number(item.duration) : undefined,
  })).filter((s) => s.id);
  return makeResponse(200, 'application/json', songs);
}

async function fetchSongDetail(base, id, quality, timeoutMs) {
  const payload = await chkszGet(
    base,
    '/api/163_music',
    { id, level: resolveLevel(quality), type: 'json' },
    timeoutMs,
  );
  return requireData(payload);
}

async function handleSong(base, id, quality, timeoutMs) {
  const data = await fetchSongDetail(base, id, quality, timeoutMs);
  return makeResponse(200, 'application/json', [{
    id: String(data.id || id),
    name: String(data.name || ''),
    artist: String(data.artist || ''),
    album: String(data.album || ''),
    pic: String(data.picUrl || ''),
    url: String(data.url || ''),
  }]);
}

async function handleUrl(base, id, quality, timeoutMs) {
  const data = await fetchSongDetail(base, id, quality, timeoutMs);
  const url = String(data.url || '');
  if (!url) throw Object.assign(new Error('chksz 未返回播放地址'), { chkszNotFound: true });
  return redirectResponse(url);
}

async function handlePic(base, id, timeoutMs) {
  const data = await fetchSongDetail(base, id, 'standard', timeoutMs);
  const pic = String(data.picUrl || '');
  if (!pic) throw Object.assign(new Error('chksz 未返回封面'), { chkszNotFound: true });
  return redirectResponse(pic);
}

async function handleLrc(base, id, timeoutMs) {
  const payload = await chkszGet(base, '/api/163_lyric', { id }, timeoutMs);
  const data = requireData(payload);
  return makeResponse(200, 'text/plain; charset=utf-8', String(data.lrc || ''));
}

async function handlePlaylist(base, id, timeoutMs) {
  const payload = await chkszGet(base, '/api/163_playlist', { id }, timeoutMs);
  const data = requireData(payload);
  const tracks = Array.isArray(data.tracks) ? data.tracks : [];
  const songs = tracks.map((t) => ({
    id: String(t.id || ''),
    name: String(t.name || ''),
    artist: Array.isArray(t.ar) ? t.ar.map((a) => a?.name).filter(Boolean).join(' / ') : String(t.artist || ''),
    album: String(t.al?.name || t.album || ''),
    pic: String(t.al?.picUrl || t.pic || ''),
  })).filter((s) => s.id);
  return makeResponse(200, 'application/json', songs);
}

/**
 * 以 Meting 查询语义请求 chksz。
 * 不支持的 server/type 抛 metingUnsupported 错误（调用方跳过该上游、不计入故障冷却）。
 */
export async function fetchChksz(base, query, timeoutMs = 10000) {
  const server = String(query.server || 'netease');
  const type = String(query.type || '');
  const id = String(query.id || '');

  if (server !== 'netease') {
    throw unsupported(`chksz 适配器不支持 server=${server}`);
  }

  try {
    switch (type) {
      case 'search':
        return await handleSearch(base, id, timeoutMs);
      case 'song':
        return await handleSong(base, id, query.quality, timeoutMs);
      case 'url':
        return await handleUrl(base, id, query.quality, timeoutMs);
      case 'pic':
        return await handlePic(base, id, timeoutMs);
      case 'lrc':
        return await handleLrc(base, id, timeoutMs);
      case 'playlist':
        return await handlePlaylist(base, id, timeoutMs);
      default:
        throw unsupported(`chksz 适配器不支持 type=${type}`);
    }
  } catch (err) {
    // 内容级失败（歌曲不存在等）按 404 返回，不让上游进入故障冷却
    if (err?.chkszNotFound) {
      return makeResponse(404, 'application/json', { error: err.message });
    }
    throw err;
  }
}
