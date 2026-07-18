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

async function chkszGet(base, path, params, timeoutMs, apiKey = '') {
  const search = new URLSearchParams(params);
  if (apiKey) search.set('apikey', apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}?${search.toString()}`, { signal: controller.signal });
    // chksz 对“未找到”场景会用 HTTP 404 承载 { code: 404, msg: ... } 正常业务 JSON；
    // 只有非 404 的非 2xx（网关错误、无 JSON 体等）才视为传输层故障
    if (!res.ok && res.status !== 404) {
      const error = new Error(`chksz 上游返回 ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function requireData(payload) {
  if (!payload) {
    throw new Error('chksz 返回空响应');
  }
  // 部分接口（如 163_playlist）不带 code 字段，仅返回 data
  if ((payload.code !== undefined && payload.code !== 200) || !payload.data) {
    const err = new Error(String(payload?.msg || 'chksz 返回异常'));
    // code >= 500 是上游系统级故障，不能当作“歌曲不存在”吞掉，否则会被判定为成功、放弃故障切换
    const isSystemError = payload.code !== undefined && payload.code >= 500;
    if (!isSystemError) {
      err.chkszNotFound = true;
    }
    throw err;
  }
  return payload.data;
}

function resolveLevel(quality) {
  return QUALITY_TO_LEVEL[String(quality || '').toLowerCase()] || 'exhigh';
}

// artists 通常已是拼接好的字符串，但网易云风格接口也可能返回 [{ name }] 数组
function normalizeArtistField(raw) {
  if (Array.isArray(raw)) {
    return raw.map((a) => (a && typeof a === 'object' ? a.name : a)).filter(Boolean).join(' / ');
  }
  return String(raw || '');
}

async function handleSearch(base, keyword, timeoutMs, apiKey) {
  const payload = await chkszGet(base, '/api/163_search', { keyword, limit: '50' }, timeoutMs, apiKey);
  const data = requireData(payload);
  const list = Array.isArray(data) ? data : (Array.isArray(data.songs) ? data.songs : []);
  const songs = list.map((item) => ({
    id: String(item.id || ''),
    name: String(item.name || ''),
    artist: normalizeArtistField(item.artists || item.artist),
    album: String(item.album || ''),
    pic: String(item.picUrl || ''),
    // 客户端 duration 语义为毫秒，chksz 原值即毫秒
    duration: Number(item.duration) > 0 ? Number(item.duration) : undefined,
  })).filter((s) => s.id);
  return makeResponse(200, 'application/json', songs);
}

async function fetchSongDetail(base, id, quality, timeoutMs, apiKey) {
  const payload = await chkszGet(
    base,
    '/api/163_music',
    { id, level: resolveLevel(quality), type: 'json' }, timeoutMs, apiKey,
  );
  return requireData(payload);
}

async function handleSong(base, id, quality, timeoutMs, apiKey) {
  const data = await fetchSongDetail(base, id, quality, timeoutMs, apiKey);
  return makeResponse(200, 'application/json', [{
    id: String(data.id || id),
    name: String(data.name || ''),
    artist: String(data.artist || ''),
    album: String(data.album || ''),
    pic: String(data.picUrl || ''),
    url: String(data.url || ''),
  }]);
}

async function handleUrl(base, id, quality, timeoutMs, apiKey) {
  const data = await fetchSongDetail(base, id, quality, timeoutMs, apiKey);
  const url = String(data.url || '');
  if (!url) throw Object.assign(new Error('chksz 未返回播放地址'), { chkszNotFound: true });
  return redirectResponse(url);
}

async function handlePic(base, id, timeoutMs, apiKey) {
  const data = await fetchSongDetail(base, id, 'standard', timeoutMs, apiKey);
  const pic = String(data.picUrl || '');
  if (!pic) throw Object.assign(new Error('chksz 未返回封面'), { chkszNotFound: true });
  return redirectResponse(pic);
}

async function handleLrc(base, id, timeoutMs, apiKey) {
  const payload = await chkszGet(base, '/api/163_lyric', { id }, timeoutMs, apiKey);
  const data = requireData(payload);
  // lrc 通常已是字符串，但网易云风格接口也可能返回 { lyric: "..." } 对象
  const lrc = data.lrc;
  const lrcText = lrc && typeof lrc === 'object' ? String(lrc.lyric || '') : String(lrc || '');
  return makeResponse(200, 'text/plain; charset=utf-8', lrcText);
}

async function handlePlaylist(base, id, timeoutMs, apiKey) {
  const payload = await chkszGet(base, '/api/163_playlist', { id }, timeoutMs, apiKey);
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

// ---------- QQ 音乐（server=tencent → /api/qq_music） ----------

// qq_music 无 code 包装：搜索返回 { count, list }，按 mid 解析返回平铺对象，
// 未找到时返回 HTTP 200 + { error: "..." }
function requireQqData(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('chksz qq_music 返回空响应');
  }
  if (payload.error) {
    throw Object.assign(new Error(String(payload.error)), { chkszNotFound: true });
  }
  return payload;
}

async function handleQqSearch(base, keyword, timeoutMs, apiKey) {
  const payload = await chkszGet(base, '/api/qq_music', { msg: keyword, num: '50' }, timeoutMs, apiKey);
  const data = requireQqData(payload);
  const list = Array.isArray(data.list) ? data.list : [];
  const songs = list.map((item) => ({
    id: String(item.id || item.mid || ''),
    name: String(item.name || ''),
    artist: normalizeArtistField(item.artists || item.artist),
    album: String(item.album || ''),
    pic: String(item.cover || ''),
  })).filter((s) => s.id);
  return makeResponse(200, 'application/json', songs);
}

async function fetchQqSongDetail(base, mid, timeoutMs, apiKey) {
  const payload = await chkszGet(base, '/api/qq_music', { mid }, timeoutMs, apiKey);
  return requireQqData(payload);
}

function pickQqCover(data) {
  const cover = data.cover;
  if (cover && typeof cover === 'object') {
    return String(cover.large || cover.medium || cover.small || '');
  }
  return String(cover || '');
}

async function handleQqSong(base, mid, timeoutMs, apiKey) {
  const data = await fetchQqSongDetail(base, mid, timeoutMs, apiKey);
  const durationSec = Number(data.duration || 0);
  return makeResponse(200, 'application/json', [{
    id: String(data.id || mid),
    name: String(data.name || ''),
    artist: normalizeArtistField(data.artists || data.artist),
    album: String(data.album?.name || data.album || ''),
    pic: pickQqCover(data),
    url: String(data.url || ''),
    // qq_music 时长为秒，客户端 duration 语义为毫秒
    duration: durationSec > 0 ? durationSec * 1000 : undefined,
    lrc: data.lyric?.text ? String(data.lyric.text) : undefined,
  }]);
}

async function handleQqUrl(base, mid, timeoutMs, apiKey) {
  const data = await fetchQqSongDetail(base, mid, timeoutMs, apiKey);
  const url = String(data.url || '');
  if (!url) throw Object.assign(new Error('chksz 未返回播放地址'), { chkszNotFound: true });
  return redirectResponse(url);
}

async function handleQqPic(base, mid, timeoutMs, apiKey) {
  const data = await fetchQqSongDetail(base, mid, timeoutMs, apiKey);
  const pic = pickQqCover(data);
  if (!pic) throw Object.assign(new Error('chksz 未返回封面'), { chkszNotFound: true });
  return redirectResponse(pic);
}

async function handleQqLrc(base, mid, timeoutMs, apiKey) {
  const data = await fetchQqSongDetail(base, mid, timeoutMs, apiKey);
  const lyric = data.lyric;
  const lrcText = lyric && typeof lyric === 'object' ? String(lyric.text || '') : String(lyric || '');
  return makeResponse(200, 'text/plain; charset=utf-8', lrcText);
}

async function fetchChkszTencent(base, type, id, timeoutMs, apiKey) {
  switch (type) {
    case 'search':
      return handleQqSearch(base, id, timeoutMs, apiKey);
    case 'song':
      return handleQqSong(base, id, timeoutMs, apiKey);
    case 'url':
      return handleQqUrl(base, id, timeoutMs, apiKey);
    case 'pic':
      return handleQqPic(base, id, timeoutMs, apiKey);
    case 'lrc':
      return handleQqLrc(base, id, timeoutMs, apiKey);
    default:
      throw unsupported(`chksz 适配器不支持 tencent type=${type}`);
  }
}

/**
 * 以 Meting 查询语义请求 chksz。支持 server=netease / tencent。
 * 不支持的 server/type 抛 metingUnsupported 错误（调用方跳过该上游、不计入故障冷却）。
 */
export async function fetchChksz(base, query, timeoutMs = 10000, apiKey = '') {
  const server = String(query.server || 'netease');
  const type = String(query.type || '');
  const id = String(query.id || '');

  if (server !== 'netease' && server !== 'tencent') {
    throw unsupported(`chksz 适配器不支持 server=${server}`);
  }

  try {
    if (server === 'tencent') {
      return await fetchChkszTencent(base, type, id, timeoutMs, apiKey);
    }
    switch (type) {
      case 'search':
        return await handleSearch(base, id, timeoutMs, apiKey);
      case 'song':
        return await handleSong(base, id, query.quality, timeoutMs, apiKey);
      case 'url':
        return await handleUrl(base, id, query.quality, timeoutMs, apiKey);
      case 'pic':
        return await handlePic(base, id, timeoutMs, apiKey);
      case 'lrc':
        return await handleLrc(base, id, timeoutMs, apiKey);
      case 'playlist':
        return await handlePlaylist(base, id, timeoutMs, apiKey);
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
